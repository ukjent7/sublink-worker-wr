import { parseServerInfo, parseUrlParams, parseArray, parseBool } from '../../utils.js';

export function parseTuic(url) {
    const { addressPart, params, name } = parseUrlParams(url);
    const [userinfo, serverInfo] = addressPart.split('@');
    const { host, port } = parseServerInfo(serverInfo);
    const tls = {
        enabled: true,
        server_name: params.sni,
        alpn: parseArray(params.alpn),
        // default to verifying certificates, opt out only when explicitly requested
        insecure: parseBool(params['skip-cert-verify'] ?? params.insecure ?? params.allowInsecure, false)
    };

    // password may contain ':', split on the first one only
    const decodedUserinfo = decodeURIComponent(userinfo);
    const sepIndex = decodedUserinfo.indexOf(':');

    return {
        // empty tags are dropped downstream, fall back to host:port
        tag: name || (host ? `${host}:${port}` : ''),
        type: 'tuic',
        server: host,
        server_port: port,
        uuid: sepIndex === -1 ? decodedUserinfo : decodedUserinfo.slice(0, sepIndex),
        password: sepIndex === -1 ? undefined : decodedUserinfo.slice(sepIndex + 1),
        congestion_control: params.congestion_control,
        tls,
        flow: params.flow ?? undefined,
        udp_relay_mode: params['udp-relay-mode'] || params.udp_relay_mode,
        zero_rtt: parseBool(params['zero-rtt'], undefined),
        reduce_rtt: parseBool(params['reduce-rtt'], undefined),
        fast_open: parseBool(params['fast-open'], undefined),
        disable_sni: parseBool(params['disable-sni'], undefined)
    };
}
