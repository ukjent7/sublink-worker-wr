import { SING_BOX_CONFIG } from '../config/index.js';
import { deepCopy } from '../utils.js';
import { parseIntervalSeconds } from '../utils/routeRuleParser.js';
import { BaseConfigBuilder } from './BaseConfigBuilder.js';
import { groupDisplayName, matchNodeTags, ruleDedupKey } from './helpers/nodeMatcher.js';

const SINGLE_GROUP_TAG = '📌 单节点';
const AGGREGATE_GROUP_TAG = '🌐 全局';

// sing-box urltest defaults: interval 3m, idle_timeout 30m (constant/timeout.go).
const DEFAULT_URLTEST_IDLE_SECONDS = 30 * 60;

// sing-box refuses to start on a group without members (`missing tags`), so an
// empty match must never create one.
const GROUP_OUTBOUND_TYPES = new Set(['selector', 'urltest']);
const BUILTIN_OUTBOUND_TYPES = new Set(['direct', 'block']);
const CONDITION_FIELD = {
    domain: 'domain',
    domain_suffix: 'domain_suffix',
    domain_regex: 'domain_regex',
    ip_cidr: 'ip_cidr'
};
// Reserved matcher words that point at an existing outbound instead of nodes.
const RESERVED_TARGETS = {
    direct: 'direct',
    block: 'block',
    global: AGGREGATE_GROUP_TAG,
    single: SINGLE_GROUP_TAG
};

const subscriptionGroupName = (index) => `✈️ 订阅${String(index + 1).padStart(2, '0')}`;

export class SingboxConfigBuilder extends BaseConfigBuilder {
    constructor(inputString, lang, options = {}) {
        super(inputString, lang, options);
        this.config = deepCopy(SING_BOX_CONFIG);
    }

    convertProxy(proxy) {
        // Copy to avoid mutating the parsed source object.
        const sanitized = { ...proxy };

        // YAML-pasted h2 transports skip the protocol parsers; sing-box has no h2 type.
        if (sanitized.transport?.type === 'h2') {
            const h2Path = sanitized.transport.path;
            sanitized.transport = { ...sanitized.transport, type: 'http', path: Array.isArray(h2Path) ? h2Path[0] : h2Path };
        }

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

        // sing-box rejects unknown encodings, keep only the valid ones.
        if (proxy.packet_encoding !== 'xudp' && proxy.packet_encoding !== 'packetaddr') {
            delete sanitized.packet_encoding;
        } else {
            sanitized.packet_encoding = proxy.packet_encoding;
        }

        // `insecure` defaults to false, omit it like the official formatter does.
        if (sanitized.tls && sanitized.tls.insecure === false) {
            const tls = { ...sanitized.tls };
            delete tls.insecure;
            sanitized.tls = tls;
        }

        if (sanitized.type === 'hysteria2') {
            // sing-box names bandwidth caps `up_mbps`/`down_mbps`.
            const upMbps = parseInt(sanitized.up, 10);
            if (!Number.isNaN(upMbps)) {
                sanitized.up_mbps = upMbps;
            }
            delete sanitized.up;
            const downMbps = parseInt(sanitized.down, 10);
            if (!Number.isNaN(downMbps)) {
                sanitized.down_mbps = downMbps;
            }
            delete sanitized.down;
            // sing-box takes a port list, not a comma-separated string.
            if (sanitized.ports !== undefined && sanitized.ports !== null && String(sanitized.ports).trim() !== '') {
                const serverPorts = String(sanitized.ports).split(',').map((port) => port.trim()).filter((port) => port !== '');
                if (serverPorts.length > 0) {
                    sanitized.server_ports = serverPorts;
                }
            }
            delete sanitized.ports;
            // Hop interval is a duration string in sing-box.
            if (typeof sanitized.hop_interval === 'number' && Number.isFinite(sanitized.hop_interval)) {
                sanitized.hop_interval = `${sanitized.hop_interval}s`;
            } else if (typeof sanitized.hop_interval === 'string') {
                const trimmedInterval = sanitized.hop_interval.trim();
                if (/^\d+(\.\d+)?$/.test(trimmedInterval)) {
                    sanitized.hop_interval = `${trimmedInterval}s`;
                } else if (/^\d+(\.\d+)?s$/.test(trimmedInterval)) {
                    sanitized.hop_interval = trimmedInterval;
                } else {
                    delete sanitized.hop_interval;
                }
            } else if (sanitized.hop_interval !== undefined) {
                delete sanitized.hop_interval;
            }
            // No sing-box counterparts for these Clash-oriented fields.
            delete sanitized.recv_window_conn;
            delete sanitized.auth;
            delete sanitized.fast_open;
        }

        if (sanitized.type === 'tuic') {
            // sing-box spells the handshake flag in full.
            if (sanitized.zero_rtt !== undefined) {
                sanitized.zero_rtt_handshake = sanitized.zero_rtt;
            }
            delete sanitized.zero_rtt;
            // DisableSNI lives inside `tls` for sing-box.
            if (sanitized.disable_sni !== undefined) {
                sanitized.tls = { ...sanitized.tls, disable_sni: sanitized.disable_sni };
            }
            delete sanitized.disable_sni;
            // No sing-box counterparts for these Clash-oriented fields.
            delete sanitized.reduce_rtt;
            delete sanitized.flow;
            delete sanitized.fast_open;
        }

        if (sanitized.type === 'trojan') {
            // Trojan outbound has no `flow` field in sing-box.
            delete sanitized.flow;
        }

        if (sanitized.type === 'shadowsocks' && sanitized.plugin_opts && typeof sanitized.plugin_opts === 'object') {
            // sing-box wants the raw SIP003 option string, not a parsed object.
            sanitized.plugin_opts = Object.entries(sanitized.plugin_opts)
                .map(([key, value]) => (value === true ? key : `${key}=${value}`))
                .join(';');
        }

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

    // User route rules get the highest priority: prepend them right after the
    // leading action-only rules, otherwise the built-in `geosite-cn -> direct`
    // matches first and the custom target is never reached.
    applyRouteRules() {
        if (!this.routeRules.length) return;

        const outbounds = this.config.outbounds || [];
        const usedTags = new Set(outbounds.map(outbound => outbound?.tag).filter(Boolean));
        const nodeTags = outbounds
            .filter(outbound => outbound && !GROUP_OUTBOUND_TYPES.has(outbound.type) && !BUILTIN_OUTBOUND_TYPES.has(outbound.type))
            .map(outbound => outbound.tag);

        const reserveTag = (baseTag) => {
            let tag = baseTag;
            let suffix = 2;
            while (usedTags.has(tag)) {
                tag = `${baseTag}_${suffix}`;
                suffix += 1;
            }
            usedTags.add(tag);
            return tag;
        };

        const groupsByKey = new Map();
        const conditionsByKey = new Map();

        for (const rule of this.routeRules) {
            const key = ruleDedupKey(rule);
            let target = resolveReservedTarget(rule, nodeTags, usedTags);

            if (!target) {
                if (!groupsByKey.has(key)) {
                    const matched = matchNodeTags(nodeTags, rule.clauses, { limit: rule.options.limit, sort: rule.options.sort });
                    const group = buildRuleGroups(rule, matched, reserveTag);
                    if (group) {
                        outbounds.push(...group);
                        // The outermost group is what the rule points at.
                        groupsByKey.set(key, group[group.length - 1].tag);
                    } else {
                        groupsByKey.set(key, resolveFallbackTarget(rule.options.fallback));
                    }
                }
                target = groupsByKey.get(key) || null;
            }
            if (!target) continue;

            mergeRuleConditions(conditionsByKey, rule, target);
        }

        const rules = buildRouteRules(conditionsByKey);
        if (rules.length === 0) return;

        const route = this.config.route;
        const existing = Array.isArray(route.rules) ? route.rules : [];
        let insertAt = 0;
        while (insertAt < existing.length && !isRoutingRule(existing[insertAt])) insertAt += 1;
        route.rules = [...existing.slice(0, insertAt), ...rules, ...existing.slice(insertAt)];
    }

    formatConfig() {
        return this.config;
    }
}

// A single positive keyword that names an existing outbound is used as-is:
// `baidu.com => direct` and `openai.com => 日本-东京` must not build a group.
function resolveReservedTarget(rule, nodeTags, knownTags) {
    if (rule.clauses.length !== 1 || rule.clauses[0].length !== 1) return null;
    const [term] = rule.clauses[0];
    if (term.negate || term.kind !== 'keyword') return null;

    const text = term.text;
    const lowered = text.toLowerCase();
    if (Object.hasOwn(RESERVED_TARGETS, lowered)) return RESERVED_TARGETS[lowered];
    if (knownTags.has(text)) return text;
    return nodeTags.find(tag => tag.toLowerCase() === lowered) || null;
}

// `fallback=none` drops the rule so the built-in routes keep their meaning.
function resolveFallbackTarget(fallback) {
    if (fallback === 'global') return AGGREGATE_GROUP_TAG;
    if (fallback === 'direct') return 'direct';
    return null;
}

function buildRuleGroups(rule, matched, reserveTag) {
    if (matched.length === 0) return null;

    const { mode, url, interval, tolerance } = rule.options;
    const display = groupDisplayName(rule);

    if (mode === 'urltest') {
        return [{ type: 'urltest', tag: reserveTag(display), outbounds: [...matched], ...urlTestOptions({ url, interval, tolerance }) }];
    }

    const tag = reserveTag(display);
    if (mode === 'both' && matched.length > 1) {
        // sing-box urltest resolves nested groups, so the selector can offer
        // "auto" plus every explicit node in one list.
        const autoTag = reserveTag(`${tag} · 自动`);
        return [
            { type: 'urltest', tag: autoTag, outbounds: [...matched], ...urlTestOptions({ url, interval, tolerance }) },
            { type: 'selector', tag, outbounds: [autoTag, ...matched], default: autoTag }
        ];
    }
    return [{ type: 'selector', tag, outbounds: [...matched], default: matched[0] }];
}

// Only pass through what the user asked for: sing-box already defaults to
// gstatic/generate_204, 3m interval and 50ms tolerance. A longer interval also
// has to raise idle_timeout, or sing-box rejects the config at startup.
function urlTestOptions({ url, interval, tolerance }) {
    const seconds = interval ? parseIntervalSeconds(interval) : null;
    return {
        ...(url ? { url } : {}),
        ...(interval ? { interval } : {}),
        ...(seconds && seconds > DEFAULT_URLTEST_IDLE_SECONDS ? { idle_timeout: interval } : {}),
        ...(tolerance ? { tolerance } : {})
    };
}

// sing-box ANDs different rule fields within one rule, so each field type gets
// its own rule; values inside a field are OR'ed by the engine.
function mergeRuleConditions(store, rule, target) {
    for (const condition of rule.conditions) {
        const field = CONDITION_FIELD[condition.type];
        const bucketKey = `${target}\u0000${field}`;
        let entry = store.get(bucketKey);
        if (!entry) {
            entry = { field, values: new Set(), outbound: target };
            store.set(bucketKey, entry);
        }
        entry.values.add(condition.value);
    }
}

function buildRouteRules(store) {
    return [...store.values()].map(entry => ({
        [entry.field]: [...entry.values].sort(),
        outbound: entry.outbound
    }));
}

function isRoutingRule(rule) {
    if (!rule) return false;
    return typeof rule.outbound === 'string' || ['route', 'direct', 'bypass', 'reject'].includes(rule.action);
}
