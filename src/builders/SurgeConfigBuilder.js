import { deepCopy } from '../utils.js';
import { SURGE_CONFIG } from '../config/index.js';
import { BaseConfigBuilder } from './BaseConfigBuilder.js';
import { addProxyWithDedup } from './helpers/proxyHelpers.js';
import { buildSelectorMembers, buildNodeSelectMembers, uniqueNames } from './helpers/groupBuilder.js';
import { createTranslator } from '../i18n/index.js';

export class SurgeConfigBuilder extends BaseConfigBuilder {
    constructor(inputString, lang) {
        super(inputString, lang);
        this.config = deepCopy(SURGE_CONFIG);
        this.t = createTranslator(lang);
        this.subscriptionUrl = null;
    }

    setSubscriptionUrl(url) {
        this.subscriptionUrl = url;
        return this;
    }

    getProxyName(proxy) {
        return proxy.split('=')[0].trim();
    }

    convertProxy(proxy) {
        let surgeProxy;
        switch (proxy.type) {
            case 'shadowsocks':
                surgeProxy = `${proxy.tag} = ss, ${proxy.server}, ${proxy.server_port}, encrypt-method=${proxy.method}, password=${proxy.password}`;
                break;
            case 'vmess':
                surgeProxy = `${proxy.tag} = vmess, ${proxy.server}, ${proxy.server_port}, username=${proxy.uuid}`;
                if (proxy.alter_id == 0) {
                    surgeProxy += ', vmess-aead=true';
                }
                if (proxy.tls?.enabled) {
                    surgeProxy += ', tls=true';
                    if (proxy.tls.server_name) {
                        surgeProxy += `, sni=${proxy.tls.server_name}`;
                    }
                    if (proxy.tls.insecure) {
                        surgeProxy += ', skip-cert-verify=true';
                    }
                    if (proxy.tls.alpn) {
                        surgeProxy += `, alpn=${proxy.tls.alpn.join(',')}`;
                    }
                }
                if (proxy.transport?.type === 'ws') {
                    surgeProxy += `, ws=true, ws-path=${proxy.transport.path}`;
                    if (proxy.transport.headers) {
                        surgeProxy += `, ws-headers=Host:${proxy.transport.headers.host}`;
                    }
                } else if (proxy.transport?.type === 'grpc') {
                    surgeProxy += `, grpc-service-name=${proxy.transport.service_name}`;
                }
                break;
            case 'trojan':
                surgeProxy = `${proxy.tag} = trojan, ${proxy.server}, ${proxy.server_port}, password=${proxy.password}`;
                if (proxy.tls?.server_name) {
                    surgeProxy += `, sni=${proxy.tls.server_name}`;
                }
                if (proxy.tls?.insecure) {
                    surgeProxy += ', skip-cert-verify=true';
                }
                if (proxy.tls?.alpn) {
                    surgeProxy += `, alpn=${proxy.tls.alpn.join(',')}`;
                }
                if (proxy.transport?.type === 'ws') {
                    surgeProxy += `, ws=true, ws-path=${proxy.transport.path}`;
                    if (proxy.transport.headers) {
                        surgeProxy += `, ws-headers=Host:${proxy.transport.headers.host}`;
                    }
                } else if (proxy.transport?.type === 'grpc') {
                    surgeProxy += `, grpc-service-name=${proxy.transport.service_name}`;
                }
                break;
            case 'hysteria2':
                surgeProxy = `${proxy.tag} = hysteria2, ${proxy.server}, ${proxy.server_port}, password=${proxy.password}`;
                if (proxy.tls?.server_name) {
                    surgeProxy += `, sni=${proxy.tls.server_name}`;
                }
                if (proxy.tls?.insecure) {
                    surgeProxy += ', skip-cert-verify=true';
                }
                if (proxy.tls?.alpn) {
                    surgeProxy += `, alpn=${proxy.tls.alpn.join(',')}`;
                }
                break;
            case 'tuic':
                surgeProxy = `${proxy.tag} = tuic, ${proxy.server}, ${proxy.server_port}, password=${proxy.password}, uuid=${proxy.uuid}`;
                if (proxy.tls?.server_name) {
                    surgeProxy += `, sni=${proxy.tls.server_name}`;
                }
                if (proxy.tls?.alpn) {
                    surgeProxy += `, alpn=${proxy.tls.alpn.join(',')}`;
                }
                if (proxy.tls?.insecure) {
                    surgeProxy += ', skip-cert-verify=true';
                }
                if (proxy.congestion_control) {
                    surgeProxy += `, congestion-controller=${proxy.congestion_control}`;
                }
                if (proxy.udp_relay_mode) {
                    surgeProxy += `, udp-relay-mode=${proxy.udp_relay_mode}`;
                }
                break;
            default:
                surgeProxy = `# ${proxy.tag} - Unsupported proxy type: ${proxy.type}`;
        }
        return surgeProxy;
    }

    createProxyGroup(name, type, options = []) {
        const sanitized = uniqueNames(options);
        const optionsPart = sanitized.length > 0 ? `, ${sanitized.join(', ')}` : '';
        return `${name} = ${type}${optionsPart}`;
    }

    // Fill-only: append proxies and the two fixed groups. No other section changes.
    fillSources({ subscriptions = [], singles = [] } = {}) {
        const ordered = [...singles];
        for (const list of subscriptions) {
            ordered.push(...(list || []));
        }

        this.config.proxies = [];
        for (const proxy of ordered) {
            const converted = this.convertProxy(proxy);
            if (!converted) continue;
            addProxyWithDedup(this.config.proxies, converted, {
                getName: (item) => (typeof item === 'string' ? this.getProxyName(item) : undefined),
                setName: (value, name) => {
                    const equalsPos = typeof value === 'string' ? value.indexOf('=') : -1;
                    if (equalsPos > 0) {
                        return `${name}${value.substring(equalsPos)}`;
                    }
                    return value;
                },
                isSame: (existing, incoming) => {
                    if (typeof existing !== 'string' || typeof incoming !== 'string') return false;
                    const existingSuffix = existing.substring(existing.indexOf('='));
                    const incomingSuffix = incoming.substring(incoming.indexOf('='));
                    return existingSuffix === incomingSuffix;
                }
            });
        }

        const validProxies = this.config.proxies.filter(proxy =>
            typeof proxy === 'string' && !proxy.trimStart().startsWith('#')
        );
        const proxyList = validProxies.map(proxy => this.getProxyName(proxy));
        this.config['proxy-groups'] = [
            this.createProxyGroup(
                this.t('outboundNames.Node Select'),
                'select',
                buildNodeSelectMembers({ proxyList, translator: this.t })
            ),
            this.createProxyGroup(
                this.t('outboundNames.Fall Back'),
                'select',
                buildSelectorMembers({ proxyList, translator: this.t })
            )
        ];
    }

    formatConfig() {
        let finalConfig = [];

        if (this.subscriptionUrl) {
            finalConfig.push(`#!MANAGED-CONFIG ${this.subscriptionUrl} interval=43200 strict=false`);
            finalConfig.push('');
        }

        finalConfig.push('[General]');
        if (this.config.general) {
            Object.entries(this.config.general).forEach(([key, value]) => {
                finalConfig.push(`${key} = ${value}`);
            });
        }

        if (this.config.replica) {
            finalConfig.push('\n[Replica]');
            Object.entries(this.config.replica).forEach(([key, value]) => {
                finalConfig.push(`${key} = ${value}`);
            });
        }

        finalConfig.push('\n[Proxy]');
        finalConfig.push('DIRECT = direct');
        if (this.config.proxies) {
            finalConfig.push(...this.config.proxies);
        }

        finalConfig.push('\n[Proxy Group]');
        if (this.config['proxy-groups']) {
            finalConfig.push(...this.config['proxy-groups']);
        }

        finalConfig.push('\n[Rule]');

        finalConfig.push('FINAL,' + this.t('outboundNames.Fall Back'));

        return finalConfig.join('\n');
    }

    getCurrentUrl() {
        try {
            if (typeof self !== 'undefined' && self.location) {
                return self.location.href;
            }
            return null;
        } catch (error) {
            console.error('Error getting current URL:', error);
            return null;
        }
    }
}
