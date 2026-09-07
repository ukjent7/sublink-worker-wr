import { parseServerInfo, parseUrlParams, createTlsConfig, createTransportConfig, parseBool } from '../../utils.js';

export function parseVless(url) {
    const { addressPart, params, name } = parseUrlParams(url);
    const [uuid, serverInfo] = addressPart.split('@');
    const { host, port } = parseServerInfo(serverInfo);

    const tls = createTlsConfig(params);
    if (tls.reality) {
        tls.utls = {
            enabled: true,
            // Respect the fp carried by the link; fall back to the previous default.
            fingerprint: params.fp || 'chrome'
        };
    }
    const transport = params.type !== 'tcp' ? createTransportConfig(params) : undefined;

    // `udp` is a Clash-only flag; ClashConfigBuilder reads it, SingboxConfigBuilder strips it.
    const udp = params.udp !== undefined ? parseBool(params.udp) : undefined;
    // Accept both camelCase and snake_case spellings from link authors.
    const packetEncoding = params.packetEncoding ?? params.packet_encoding;

    return {
        type: 'vless',
        // empty tags are dropped downstream, fall back to host:port
        tag: name || (host ? `${host}:${port}` : ''),
        server: host,
        server_port: port,
        uuid: decodeURIComponent(uuid),
        tls,
        transport,
        flow: params.flow ?? undefined,
        // Pass through untouched; validation belongs to the conversion layer.
        ...(packetEncoding ? { packet_encoding: packetEncoding } : {}),
        ...(udp !== undefined ? { udp } : {})
    };
}
