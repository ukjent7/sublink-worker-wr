// Turns a parsed route-rule matcher into concrete node tags.
// Platform-neutral: sing-box groups today, Clash proxy-groups later.

const REGEX_CACHE = new Map();

// sing-box rejects groups with no members, so an empty result is a valid
// answer and the caller decides the fallback.
export function matchNodeTags(tags, clauses, { limit = 0, sort = 'input' } = {}) {
    const matched = (tags || []).filter(tag => clauseMatches(tag, clauses));
    if (sort === 'name') {
        // Code-point order instead of locale collation: the generated group
        // has to be identical across runtimes.
        matched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
    return limit > 0 ? matched.slice(0, limit) : matched;
}

export function clauseMatches(tag, clauses) {
    const value = String(tag);
    const lowered = value.toLowerCase();
    return (clauses || []).some(clause => clause.every(term => termHits(term, value, lowered) !== term.negate));
}

// Keywords always match case-insensitively; regex terms keep the semantics of
// their own flags so `/^US-\d+$/` can stay case-sensitive on purpose.
function termHits(term, tag, loweredTag) {
    if (term.kind === 'regex') return compileRegex(term.pattern, term.flags).test(tag);
    return loweredTag.includes(term.text.toLowerCase());
}

function compileRegex(pattern, flags) {
    const key = `${pattern}\u0000${flags || ''}`;
    let compiled = REGEX_CACHE.get(key);
    if (!compiled) {
        compiled = new RegExp(pattern, flags);
        REGEX_CACHE.set(key, compiled);
    }
    return compiled;
}

// Group tag/keys must depend on the rule text only, never on which nodes
// happen to match: sing-box remembers the manual selection per selector tag in
// its cache file, and a shifting name would reset it on every refresh.
export function ruleDedupKey(rule) {
    const { mode, name, limit, sort, fallback, url, interval, tolerance } = rule.options;
    return [rule.expression, mode, name, limit, sort, fallback, url, interval, tolerance].join('\u0000');
}

export function groupDisplayName(rule, prefix = '🎯') {
    return rule.options.name || `${prefix} ${rule.expression}`;
}
