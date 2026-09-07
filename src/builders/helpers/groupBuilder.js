const normalize = (value) => typeof value === 'string' ? value.trim() : value;

export function uniqueNames(names = []) {
    const seen = new Set();
    const result = [];
    names.forEach(name => {
        if (typeof name !== 'string') return;
        const normalized = normalize(name);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
}

export function withDirectReject(options = [], { includeReject = true } = {}) {
    return uniqueNames([
        ...options,
        'DIRECT',
        ...(includeReject ? ['REJECT'] : [])
    ]);
}

export function buildNodeSelectMembers({ proxyList = [], translator, includeReject = true }) {
    if (!translator) {
        throw new Error('buildNodeSelectMembers requires a translator function');
    }
    return withDirectReject([...proxyList], { includeReject });
}

export function buildSelectorMembers({ proxyList = [], translator, includeReject = true }) {
    if (!translator) {
        throw new Error('buildSelectorMembers requires a translator function');
    }
    const base = [
        translator('outboundNames.Node Select'),
        ...proxyList
    ];
    return withDirectReject(base, { includeReject });
}
