import { parseServerInfo, parseUrlParams, createTlsConfig, parseMaybeNumber, parseArray, parseBool } from '../../utils.js';

export function parseHysteria2(url) {
    const { addressPart, params, name } = parseUrlParams(url);
    let host;
    let port;
    let password = null;

    if (addressPart.includes('@')) {
        const [uuid, serverInfo] = addressPart.split('@');
        const parsed = parseServerInfo(serverInfo);
        host = parsed.host;
        port = parsed.port;
        password = decodeURIComponent(uuid);
    } else {
        const parsed = parseServerInfo(addressPart);
        host = parsed.host;
        port = parsed.port;
        password = params.auth;
    }
    // auth and password are aliases in the URI spec, keep both fields for consumers
    if (!password && params.auth) password = params.auth;

    // Hysteria2 requires TLS by protocol design
    if (!params.security) params.security = 'tls';
    const tls = createTlsConfig(params);
    const obfs = {};
    if (params['obfs-password']) {
        obfs.type = params.obfs;
        obfs.password = params['obfs-password'];
    }

    return {
        // empty tags are dropped downstream, fall back to host:port
        tag: name || (host ? `${host}:${port}` : ''),
        type: 'hysteria2',
        server: host,
        server_port: port,
        password: password,
        tls,
        obfs: Object.keys(obfs).length > 0 ? obfs : undefined,
        auth: params.auth,
        recv_window_conn: params.recv_window_conn,
        up: params.up ?? (params.upmbps ? parseMaybeNumber(params.upmbps) : undefined),
        down: params.down ?? (params.downmbps ? parseMaybeNumber(params.downmbps) : undefined),
        ports: params.ports,
        // Clash reads seconds as a number; durations like "30s" stay raw for the builder.
        hop_interval: /^\d+$/.test(params['hop-interval'] ?? '') ? Number(params['hop-interval']) : params['hop-interval'],
        alpn: parseArray(params.alpn),
        fast_open: parseBool(params['fast-open'])
    };
}
