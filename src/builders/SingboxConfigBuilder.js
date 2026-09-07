import { SING_BOX_CONFIG } from '../config/index.js';
import { deepCopy } from '../utils.js';
import { BaseConfigBuilder } from './BaseConfigBuilder.js';

const SINGLE_GROUP_TAG = '📌 单节点';
const AGGREGATE_GROUP_TAG = '🌐 全局';

const subscriptionGroupName = (index) => `✈️ 订阅${String(index + 1).padStart(2, '0')}`;

export class SingboxConfigBuilder extends BaseConfigBuilder {
    constructor(inputString, lang) {
        super(inputString, lang);
        this.config = deepCopy(SING_BOX_CONFIG);
    }

    convertProxy(proxy) {
        // Copy to avoid mutating the parsed source object.
        const sanitized = { ...proxy };

        // `udp` is Clash-only. Top-level `network` in sing-box is a TCP/UDP
        // allowlist; a stray "tcp" silently disables UDP for the node.
        delete sanitized.udp;
        delete sanitized.network;

        // alpn belongs inside `tls` for sing-box.
        if (sanitized.alpn && sanitized.tls) {
            if (!sanitized.tls.alpn) {
                sanitized.tls = { ...sanitized.tls, alpn: sanitized.alpn };
            }
            delete sanitized.alpn;
        } else if (sanitized.alpn && !sanitized.tls) {
            delete sanitized.alpn;
        }

        delete sanitized.packet_encoding;

        return sanitized;
    }

    // Fill-only: append node outbounds, fill group member lists, and fill an
    // empty default. Existing entries are never modified or removed.
    fillSources({ subscriptions = [], singles = [] } = {}) {
        const outbounds = this.config.outbounds || [];
        const usedTags = new Set(outbounds.map(outbound => outbound?.tag).filter(Boolean));
        const singleGroup = outbounds.find(outbound => outbound?.tag === SINGLE_GROUP_TAG && Array.isArray(outbound.outbounds));
        const aggregateGroup = outbounds.find(outbound => outbound?.tag === AGGREGATE_GROUP_TAG && Array.isArray(outbound.outbounds));

        const appendNode = (proxy) => {
            const converted = this.convertProxy(proxy);
            if (!converted || typeof converted.tag !== 'string' || converted.tag === '') {
                return null;
            }
            const baseTag = converted.tag;
            let tag = baseTag;
            let suffix = 2;
            while (usedTags.has(tag)) {
                tag = `${baseTag}_${suffix}`;
                suffix += 1;
            }
            converted.tag = tag;
            usedTags.add(tag);
            outbounds.push(converted);
            return tag;
        };

        const singleTags = [];
        for (const proxy of singles) {
            const tag = appendNode(proxy);
            if (tag) singleTags.push(tag);
        }
        if (singleGroup) {
            singleGroup.outbounds.push(...singleTags);
            if (!singleGroup.default && singleTags.length > 0) {
                singleGroup.default = singleTags[0];
            }
        }

        const newGroupTags = [];
        subscriptions.forEach((list, index) => {
            const memberTags = [];
            for (const proxy of list || []) {
                const tag = appendNode(proxy);
                if (tag) memberTags.push(tag);
            }
            if (memberTags.length === 0) return;
            let groupTag = subscriptionGroupName(index);
            let suffix = 2;
            while (usedTags.has(groupTag)) {
                groupTag = `${subscriptionGroupName(index)}_${suffix}`;
                suffix += 1;
            }
            usedTags.add(groupTag);
            outbounds.push({ type: 'selector', tag: groupTag, outbounds: memberTags, default: memberTags[0] });
            newGroupTags.push(groupTag);
        });

        if (aggregateGroup) {
            const freshTags = newGroupTags.filter(tag => !aggregateGroup.outbounds.includes(tag));
            const anchor = aggregateGroup.outbounds.indexOf(SINGLE_GROUP_TAG);
            const insertAt = anchor >= 0 ? anchor + 1 : aggregateGroup.outbounds.length;
            aggregateGroup.outbounds.splice(insertAt, 0, ...freshTags);
        }

        // Requested display order: direct, block, nodes, then the
        // aggregate group, the single group, and subscription groups last.
        // Everything else keeps its relative order.
        const headRank = new Map([['direct', 0], ['block', 1]]);
        const tailRank = new Map([AGGREGATE_GROUP_TAG, SINGLE_GROUP_TAG, ...newGroupTags].map((tag, index) => [tag, index]));
        const head = [];
        const nodes = [];
        const tail = [];
        for (const outbound of outbounds) {
            if (outbound && headRank.has(outbound.tag)) {
                head.push(outbound);
            } else if (outbound && tailRank.has(outbound.tag)) {
                tail.push(outbound);
            } else {
                nodes.push(outbound);
            }
        }
        head.sort((a, b) => headRank.get(a.tag) - headRank.get(b.tag));
        tail.sort((a, b) => tailRank.get(a.tag) - tailRank.get(b.tag));
        this.config.outbounds = [...head, ...nodes, ...tail];
    }

    formatConfig() {
        return this.config;
    }
}
