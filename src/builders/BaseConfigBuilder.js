import { ProxyParser } from '../parsers/index.js';
import { deepCopy, tryDecodeSubscriptionLines, decodeBase64, V2RAYN_USER_AGENT } from '../utils.js';

// Skeleton configs are immutable except for two append-only operations:
// builders may add node/group outbounds and prepend user route rules.
// Existing entries are never modified or removed.
export class BaseConfigBuilder {
    constructor(inputString, lang, options = {}) {
        this.inputString = inputString;
        this.lang = lang;
        this.routeRules = Array.isArray(options.routeRules) ? options.routeRules : [];
        this.subscriptionUserinfo = undefined;
    }

    async build() {
        const sources = await this.parseInputsBySource();
        this.fillSources(sources);
        // Route rules run after fillSources so they match final, deduped tags.
        this.applyRouteRules();
        return this.formatConfig();
    }

    // Split input by origin so subscription URLs each fill their own group
    // while bare node links share the single-node group.
    // Returns { subscriptions: Array<Array<proxy>>, singles: Array<proxy> }.
    // Full-config pastes (Clash/Sing-Box/Surge) only contribute their nodes;
    // any non-proxy sections are ignored to keep the skeleton untouched.
    async parseInputsBySource() {
        const { parseSubscriptionContent } = await import('../parsers/subscription/subscriptionContentParser.js');
        const subscriptions = [];
        const singles = [];
        const input = this.inputString || '';

        const pushProxy = (bucket, item) => {
            if (item && typeof item === 'object' && item.tag) {
                bucket.push(item);
            }
        };

        const collectParsed = async (parsed, bucket) => {
            if (!parsed) return;
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item === 'object' && item.tag) {
                        bucket.push(item);
                    } else if (typeof item === 'string' && item.trim() !== '') {
                        const subResult = await ProxyParser.parse(item.trim(), V2RAYN_USER_AGENT);
                        if (Array.isArray(subResult)) {
                            subResult.forEach(entry => pushProxy(bucket, entry));
                        } else if (subResult && typeof subResult === 'object' && Array.isArray(subResult.proxies)) {
                            subResult.proxies.forEach(entry => pushProxy(bucket, entry));
                        } else {
                            pushProxy(bucket, subResult);
                        }
                    }
                }
                return;
            }
            if (typeof parsed === 'object') {
                if (Array.isArray(parsed.proxies)) {
                    parsed.proxies.forEach(entry => pushProxy(bucket, entry));
                    return;
                }
                pushProxy(bucket, parsed);
            }
        };

        const directResult = parseSubscriptionContent(input);
        if (directResult && typeof directResult === 'object' && directResult.type) {
            await collectParsed(directResult, singles);
            if (singles.length > 0) return { subscriptions, singles };
        }

        const isBase64Like = /^[A-Za-z0-9+/=\r\n]+$/.test(input) && input.replace(/[\r\n]/g, '').length % 4 === 0;
        if (isBase64Like) {
            try {
                const decodedWhole = decodeBase64(input.replace(/\s+/g, ''));
                if (typeof decodedWhole === 'string') {
                    const decodedResult = parseSubscriptionContent(decodedWhole);
                    if (decodedResult && typeof decodedResult === 'object' && decodedResult.type) {
                        await collectParsed(decodedResult, singles);
                        if (singles.length > 0) return { subscriptions, singles };
                    }
                }
            } catch (_) { }
        }

        const urls = input.split('\n').filter(url => url.trim() !== '');
        for (const url of urls) {
            let processedUrls = tryDecodeSubscriptionLines(url);
            if (!Array.isArray(processedUrls)) {
                processedUrls = [processedUrls];
            }

            for (const processedUrl of processedUrls) {
                const trimmedUrl = typeof processedUrl === 'string' ? processedUrl.trim() : '';
                if (!trimmedUrl) continue;

                if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
                    const { fetchSubscriptionWithFormat } = await import('../parsers/subscription/httpSubscriptionFetcher.js');
                    try {
                        const fetchResult = await fetchSubscriptionWithFormat(trimmedUrl, V2RAYN_USER_AGENT);
                        if (!fetchResult) continue;
                        if (fetchResult.subscriptionUserinfo && !this.subscriptionUserinfo) {
                            this.subscriptionUserinfo = fetchResult.subscriptionUserinfo;
                        }
                        const group = [];
                        await collectParsed(parseSubscriptionContent(fetchResult.content), group);
                        if (group.length > 0) {
                            subscriptions.push(group);
                        }
                    } catch (error) {
                        console.error('Error processing HTTP subscription:', error);
                    }
                    continue;
                }

                const result = await ProxyParser.parse(trimmedUrl, V2RAYN_USER_AGENT);
                await collectParsed(result, singles);
            }
        }

        return { subscriptions, singles };
    }

    getSubscriptionUserinfo() {
        return this.subscriptionUserinfo;
    }

    convertProxy(proxy) {
        throw new Error('convertProxy must be implemented in child class');
    }

    fillSources(sources) {
        throw new Error('fillSources must be implemented in child class');
    }

    // Optional: map this.routeRules onto the filled config.
    applyRouteRules() {
    }

    formatConfig() {
        throw new Error('formatConfig must be implemented in child class');
    }
}
