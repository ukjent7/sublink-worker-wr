import { parseServerInfo, parseUrlParams, createTlsConfig, createTransportConfig } from '../../utils.js';

export function parseTrojan(url) {
    const { addressPart, params, name } = parseUrlParams(url);
    // password may contain '@', split on the last one to keep host parsing correct
    const atIndex = addressPart.lastIndexOf('@');
    const password = atIndex === -1 ? addressPart : addressPart.slice(0, atIndex);
    const serverInfo = atIndex === -1 ? '' : addressPart.slice(atIndex + 1);
    const { host, port } = parseServerInfo(serverInfo);

    const parsedURL = parseServerInfo(addressPart);
    // Trojan requires TLS by protocol design
    if (!params.security) params.security = 'tls';
    const tls = createTlsConfig(params);
    const transport = params.type !== 'tcp' ? createTransportConfig(params) : undefined;
    return {
        type: 'trojan',
        // empty tags are dropped downstream, fall back to host:port
        tag: name || (host ? `${host}:${port}` : ''),
        server: host,
        server_port: port,
        password: decodeURIComponent(password) || parsedURL.username,
        tls,
        transport,
        flow: params.flow ?? undefined
    };
}
