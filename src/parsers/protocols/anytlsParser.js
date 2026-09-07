import { parseServerInfo, parseUrlParams, createTlsConfig } from '../../utils.js';

export function parseAnytls(url) {
    const { addressPart, params, name } = parseUrlParams(url);
    // Password may contain '@', split on the last one like trojan links.
    const atIndex = addressPart.lastIndexOf('@');
    const userinfo = atIndex >= 0 ? addressPart.slice(0, atIndex) : '';
    const serverInfo = atIndex >= 0 ? addressPart.slice(atIndex + 1) : addressPart;
    const { host, port } = parseServerInfo(serverInfo);
    // AnyTLS is TLS-only, so force the TLS branch.
    const tls = createTlsConfig({ ...params, security: 'tls' });
    return {
        tag: name || (host ? `${host}:${port}` : ''),
        type: 'anytls',
        server: host,
        server_port: port,
        password: decodeURIComponent(userinfo),
        tls
    };
}
