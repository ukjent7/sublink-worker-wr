import { decodeBase64 } from '../../utils.js';

function normalizeArray(value) {
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
}

function buildHttpHeaders(vmessConfig) {
    const hostHeader = normalizeArray(vmessConfig.host || vmessConfig.sni);
    if (vmessConfig.headers && typeof vmessConfig.headers === 'object') {
        const normalized = {};
        Object.entries(vmessConfig.headers).forEach(([key, value]) => {
            const normalizedValue = normalizeArray(value)?.map(entry => `${entry}`);
            if (normalizedValue && normalizedValue.length > 0) {
                normalized[key] = normalizedValue;
            }
        });
        if (hostHeader && !normalized.host) {
            normalized.host = hostHeader;
        }
        if (Object.keys(normalized).length > 0) {
            return normalized;
        }
    }
    return hostHeader ? { host: hostHeader } : undefined;
}

function firstPath(value) {
    // sing-box HTTP transport takes a single path string, not a list.
    if (Array.isArray(value)) return value[0] || '/';
    return value || '/';
}

export function parseVmess(url) {
    let base64WithFragment = url.replace('vmess://', '');
    let tagOverride;
    const hashPos = base64WithFragment.indexOf('#');
    if (hashPos >= 0) {
        tagOverride = decodeURIComponent(base64WithFragment.slice(hashPos + 1));
        base64WithFragment = base64WithFragment.slice(0, hashPos);
    }

    let vmessConfig = JSON.parse(decodeBase64(base64WithFragment));
    let tls = { enabled: false };
    let transport;
    const networkType = vmessConfig.net || 'tcp';
    const transportType = vmessConfig.type || networkType;

    const tlsEnabled = vmessConfig.tls && vmessConfig.tls !== '' && vmessConfig.tls !== 'none';
    if (tlsEnabled) {
        tls = {
            enabled: true,
            server_name: vmessConfig.sni,
            insecure: vmessConfig['skip-cert-verify'] || false
        };
    }

    if (networkType === 'ws') {
        transport = {
            type: 'ws',
            path: vmessConfig.path,
            headers: { 'host': vmessConfig.host ? vmessConfig.host : vmessConfig.sni }
        };
    } else if ((networkType === 'tcp' && transportType === 'http') || networkType === 'http') {
        const method = vmessConfig.method || 'GET';
        transport = {
            type: 'http',
            method,
            path: firstPath(vmessConfig.path),
            headers: buildHttpHeaders(vmessConfig)
        };
    } else if (networkType === 'grpc') {
        transport = {
            type: 'grpc',
            service_name: vmessConfig?.path || vmessConfig?.serviceName
        };
    } else if (networkType === 'h2') {
        // sing-box has no h2 transport; Xray h2 is HTTP/2 which sing-box models as http.
        const hostValue = vmessConfig.host || vmessConfig.sni;
        transport = {
            type: 'http',
            method: vmessConfig.method || 'GET',
            path: firstPath(vmessConfig.path),
            host: hostValue ? (Array.isArray(hostValue) ? hostValue : [hostValue]) : undefined,
            headers: buildHttpHeaders(vmessConfig)
        };
    }

    return {
        // empty tags are dropped downstream, fall back to host:port
        tag: (tagOverride || vmessConfig.ps) || (vmessConfig.add ? `${vmessConfig.add}:${vmessConfig.port}` : ''),
        type: 'vmess',
        server: vmessConfig.add,
        server_port: parseInt(vmessConfig.port),
        uuid: vmessConfig.id,
        alter_id: parseInt(vmessConfig.aid) || 0,
        security: vmessConfig.scy || 'auto',
        tcp_fast_open: false,
        transport,
        tls: tls.enabled ? tls : undefined
    };
}
