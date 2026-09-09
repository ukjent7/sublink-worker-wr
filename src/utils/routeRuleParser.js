// Parser for the user-authored custom route rules.
//
// Grammar (one rule per line):
//   <conditions> => <node matcher> [k=v options...]
//
// Conditions are separated by comma or whitespace:
//   baidu.com / *.baidu.com / .baidu.com  -> domain_suffix (apex + subdomains)
//   =baidu.com                            -> domain (exact)
//   ~\.(tv|me)$                           -> domain_regex (swallowed to whitespace)
//   1.2.3.0/24 / fd00::/8 / 1.2.3.4       -> ip_cidr
//
// Node matcher terms are separated by comma or whitespace and OR'ed together;
// `+` AND'es terms inside one branch, a leading `-`/`!` negates a term, and
// `"..."` / `/re/flags` keep separators literal.
//
// Output is a neutral AST so other builders can reuse it later. Errors are
// returned as { line, code, arg } and translated by the caller.

export const MAX_ROUTE_RULES = 50;
export const MAX_RULE_CONDITIONS = 100;

export const ROUTE_RULE_OPTIONS = {
    name: 'string',
    mode: 'mode',
    limit: 'limit',
    sort: 'sort',
    fallback: 'fallback',
    url: 'url',
    interval: 'duration',
    tolerance: 'tolerance'
};

export const DEFAULT_ROUTE_RULE_OPTIONS = {
    name: '',
    mode: 'selector',
    limit: 0,
    sort: 'input',
    fallback: 'none',
    url: '',
    interval: '',
    tolerance: 0
};

const MODES = new Set(['selector', 'urltest', 'both']);
const SORTS = new Set(['input', 'name']);
const FALLBACKS = new Set(['none', 'global', 'direct']);
// `=>` / `->` 外加中文输入法常误触的全角形式（＝＞、→ 等），小白直接粘贴也不炸。
const SEPARATOR_RE = /=>|->|＝＞|＝>|=＞|→|—＞|―＞/;
const OPTION_PREFIX_RE = /^[a-z][a-z0-9_-]*[=＝]$/i;
// 中文逗号、顿号、分号都当“或”：dmm.co.jp，dlsite.com 不再 400。
const LIST_SEP_RE = /^[，、；;]$/;
const isListSep = (char) => char === ',' || LIST_SEP_RE.test(char) || /\s/.test(char);
const isPlusSep = (char) => char === '+' || char === '＋';
const MAX_DURATION_SECONDS = 24 * 60 * 60;
// Unicode hostnames are allowed: IDN domains show up in both sites and node tags.
const HOSTNAME_RE = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}\-_]*[\p{L}\p{N}])?\.)+[\p{L}\p{N}](?:[\p{L}\p{N}\-_]*[\p{L}\p{N}])?$/u;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

const ERROR = (line, code, arg = '') => ({ line, code, arg });

class ParseAbort extends Error {
    constructor(error) {
        super(error.code);
        this.error = error;
    }
}

// A token is a list of segments: `plain` text plus `quoted`/`regex` runs that
// may contain the separators themselves.
function tokenize(text, line) {
    const tokens = [];
    let segments = [];
    let buffer = '';

    const flushBuffer = () => {
        if (buffer !== '') {
            segments.push({ kind: 'plain', value: buffer });
            buffer = '';
        }
    };
    const closeToken = () => {
        flushBuffer();
        if (segments.length > 0) tokens.push(segments);
        segments = [];
    };
    // Atomic runs keep whatever prefix was already buffered (`name=`, `-`).
    const pushSegment = (segment) => {
        flushBuffer();
        segments.push(segment);
    };
    // True at the start of a term (`-"洛杉矶 01"`, `-/US-\d+/i`) and right after
    // an option key (`name="My Group"`), the only places where a quoted or
    // regex run may begin.
    const atTermStart = () => segments.length === 0 && (/^[-!]*$/.test(buffer) || OPTION_PREFIX_RE.test(buffer));

    for (let index = 0; index < text.length;) {
        const char = text[index];
        if (isListSep(char)) {
            closeToken();
            index += 1;
            continue;
        }
        // `~` runs to whitespace because regex bodies are full of commas; a
        // comma only ends it when a space follows, so lists stay readable.
        if (char === '~' && atTermStart()) {
            const end = findRegexConditionEnd(text, index + 1);
            pushSegment({ kind: 'regex', value: text.slice(index + 1, end) });
            index = end;
            continue;
        }
        if (char === '"' && atTermStart()) {
            const end = text.indexOf('"', index + 1);
            if (end < 0) throw new ParseAbort(ERROR(line, 'routeRuleErrorUnterminated', '"'));
            pushSegment({ kind: 'quoted', value: text.slice(index + 1, end) });
            index = end + 1;
            continue;
        }
        if (char === '/' && atTermStart()) {
            const closing = findRegexEnd(text, index);
            if (closing < 0) throw new ParseAbort(ERROR(line, 'routeRuleErrorUnterminated', '/'));
            const flagEnd = readRegexFlags(text, closing + 1);
            const pattern = text.slice(index + 1, closing);
            const flags = text.slice(closing + 1, flagEnd);
            assertValidRegex(pattern, flags, line);
            pushSegment({ kind: 'regex', value: pattern, flags });
            index = flagEnd;
            continue;
        }
        buffer += char;
        index += 1;
    }
    closeToken();
    return tokens;
}

function findRegexConditionEnd(text, start) {
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (/\s/.test(char)) return index;
        if ((char === ',' || LIST_SEP_RE.test(char)) && (index + 1 >= text.length || /\s/.test(text[index + 1]) || isListSep(text[index + 1]))) return index;
    }
    return text.length;
}

function findRegexEnd(text, start) {
    for (let index = start + 1; index < text.length; index += 1) {
        if (text[index] === '\\') {
            index += 1;
            continue;
        }
        if (text[index] === '/') return index;
    }
    return -1;
}

function readRegexFlags(text, start) {
    let index = start;
    while (index < text.length && /[a-z]/i.test(text[index])) index += 1;
    return index;
}

function assertValidRegex(pattern, flags, line) {
    try {
        new RegExp(pattern, flags);
    } catch (cause) {
        throw new ParseAbort(ERROR(line, 'routeRuleErrorInvalidRegex', pattern));
    }
}

function joinValue(segments) {
    return segments.map(segment => segment.value).join('');
}

function singleRegex(segments) {
    return segments.length === 1 && segments[0].kind === 'regex' ? segments[0] : null;
}

function parseCIDR(value) {
    const host = value.includes('%') ? value.slice(0, value.indexOf('%')) : value;
    const [rawHost, rawPrefix, extra] = host.split('/');
    if (extra !== undefined) return null;
    const isIPv6 = rawHost.includes(':');
    if (isIPv6) {
        if (!/^[0-9a-f:.]+$/i.test(rawHost)) return null;
    } else if (!IPV4_RE.test(rawHost) || rawHost.split('.').some(part => Number(part) > 255)) {
        return null;
    }
    if (rawPrefix === undefined) return { host: rawHost, prefix: null, isIPv6 };
    if (!/^\d{1,3}$/.test(rawPrefix)) return null;
    const prefix = Number(rawPrefix);
    if (prefix > (isIPv6 ? 128 : 32)) return null;
    return { host: rawHost, prefix, isIPv6 };
}

function extractHostnameCandidate(raw) {
    let s = String(raw || '').trim();
    if (!s) return s;
    // IP段原样保留：1.2.3.0/24、fd00::/8 不能当网址路径砍掉。
    if (/^[0-9a-f:.]+\/\d{1,3}$/i.test(s)) return s;
    // 小白经常直接粘贴链接：https://www.dlsite.com/home?a=1 => dlsite.com
    // 这里只做无害提取，引号/正则原样保留给上层处理。
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
        try {
            const url = new URL(s);
            // host 里的端口顺手去掉，路径不要
            s = url.hostname || s;
            return s.trim();
        } catch { /* 掉下去走普通校验报错 */ }
    }
    // 无协议粘贴：www.dlsite.com/path?x=1#y => www.dlsite.com
    // 但 IP段已提前返回，这里砍路径是安全的。
    const slash = s.indexOf('/');
    if (slash >= 0) s = s.slice(0, slash);
    const q = s.indexOf('?');
    if (q >= 0) s = s.slice(0, q);
    const hash = s.indexOf('#');
    if (hash >= 0) s = s.slice(0, hash);
    // 顺手去掉首尾的全角标点和空白：，、；。
    s = s.replace(/^[，、；;,。\.\s]+|[，、；;,。\.\s]+$/g, '');
    // 纯主机名带端口：example.com:8080 => example.com（IPv6 不动）
    if (!s.includes(':') || /^[^:]+:\d+$/.test(s)) {
        const colon = s.lastIndexOf(':');
        if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) s = s.slice(0, colon);
    }
    return s.trim();
}

function parseCondition(segments, line) {
    const regex = singleRegex(segments);
    if (regex) {
        assertValidRegex(regex.value, regex.flags || '', line);
        return { type: 'domain_regex', value: regex.value };
    }

    let raw = joinValue(segments);
    raw = extractHostnameCandidate(raw);
    if (raw.startsWith('=')) {
        const value = raw.slice(1).toLowerCase();
        if (!HOSTNAME_RE.test(value)) throw new ParseAbort(ERROR(line, 'routeRuleErrorInvalidCondition', raw));
        return { type: 'domain', value };
    }

    const cidr = parseCIDR(raw);
    if (cidr) {
        return { type: 'ip_cidr', value: cidr.prefix === null ? cidr.host : `${cidr.host}/${cidr.prefix}` };
    }
    // Address-shaped input never falls through to hostname matching: `1.2.3.400`
    // would otherwise pass the hostname check and become a bogus suffix.
    if (raw.includes(':') || /^[\d.]+$/.test(raw)) {
        throw new ParseAbort(ERROR(line, 'routeRuleErrorInvalidCondition', raw));
    }

    const suffix = raw.replace(/^(\*\.?|\.)/, '').toLowerCase();
    if (!HOSTNAME_RE.test(suffix)) throw new ParseAbort(ERROR(line, 'routeRuleErrorInvalidCondition', raw));
    return { type: 'domain_suffix', value: suffix };
}

function parseTerm(segments, line) {
    let parts = segments;
    let negate = false;
    const [first, ...rest] = parts;
    const lead = first?.value?.[0];
    if (first.kind === 'plain' && (lead === '-' || lead === '!' || lead === '－' || lead === '—')) {
        negate = true;
        const remainder = first.value.slice(1);
        parts = remainder === '' ? rest : [{ kind: 'plain', value: remainder }, ...rest];
    }
    if (parts.length === 0) throw new ParseAbort(ERROR(line, 'routeRuleErrorEmptyTarget', joinValue(segments)));

    const regex = singleRegex(parts);
    if (regex) {
        return { negate, kind: 'regex', pattern: regex.value, flags: regex.flags || '' };
    }
    const text = joinValue(parts);
    if (text === '') throw new ParseAbort(ERROR(line, 'routeRuleErrorEmptyTarget', joinValue(segments)));
    return { negate, kind: 'keyword', text };
}

// `+`（含全角 ＋） only splits inside plain runs so quoted terms and regex bodies survive.
function splitAndTerms(segments) {
    const terms = [];
    let current = [];
    for (const segment of segments) {
        if (segment.kind !== 'plain') {
            current.push(segment);
            continue;
        }
        // 手动按 + / ＋ 切分，避免 String.split 吞掉空项语义变化。
        let chunk = '';
        const pushChunk = () => {
            if (chunk !== '') current.push({ kind: 'plain', value: chunk });
            chunk = '';
        };
        for (const char of segment.value) {
            if (isPlusSep(char)) {
                pushChunk();
                terms.push(current);
                current = [];
            } else {
                chunk += char;
            }
        }
        pushChunk();
    }
    terms.push(current);
    return terms.filter(term => term.length > 0);
}

// Outer array is OR (one per comma/space separated token), inner array is AND
// (the `+` terms of that token). A token that starts with a negation narrows
// the previous branch instead of becoming an OR branch that matches nearly
// every node: `us,-到期` means "us but not 到期".
function parseMatcherTokens(tokens, line) {
    const clauses = [];
    for (const token of tokens) {
        const terms = splitAndTerms(token).map(segments => parseTerm(segments, line));
        if (terms.length === 0) throw new ParseAbort(ERROR(line, 'routeRuleErrorEmptyTarget', joinValue(token)));
        if (terms[0].negate && clauses.length > 0) {
            clauses[clauses.length - 1].push(...terms);
        } else {
            clauses.push(terms);
        }
    }
    return clauses;
}

const OPTION_LIKE_RE = /^[a-z][a-z0-9_-]*[=＝]/i;

// A plain `key=` token is always read as an option, known or not: unknown keys
// must surface as typos rather than become node names matching nothing.
function looksLikeOption(token) {
    if (token[0].kind !== 'plain') return false;
    return OPTION_LIKE_RE.test(joinValue(token));
}

function parseOption(token) {
    let raw = joinValue(token);
    // mode＝urltest 这种全角等号也认，避免小白卡死。
    raw = raw.replace(/＝/g, '=');
    const eq = raw.indexOf('=');
    if (eq <= 0) return null;
    const key = raw.slice(0, eq);
    const kind = ROUTE_RULE_OPTIONS[key];
    if (!kind) return null;
    return { key, kind, text: raw.slice(eq + 1), raw };
}

export function parseIntervalSeconds(value) {
    const match = /^(\d+)(s|m|h|d)$/.exec(value);
    if (!match) return null;
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
    return Number(match[1]) * unit;
}

function applyOption(options, parsed, line) {
    const { key, kind, text, raw } = parsed;
    const invalid = () => new ParseAbort(ERROR(line, 'routeRuleErrorInvalidOption', raw));

    if (kind === 'string') {
        if (text === '') throw invalid();
        options[key] = text;
        return;
    }
    if (kind === 'mode' || kind === 'sort' || kind === 'fallback') {
        const allowed = kind === 'mode' ? MODES : kind === 'sort' ? SORTS : FALLBACKS;
        if (!allowed.has(text)) throw invalid();
        options[key] = text;
        return;
    }
    if (kind === 'url') {
        if (!/^https?:\/\//i.test(text)) throw invalid();
        options.url = text;
        return;
    }
    if (kind === 'duration') {
        const seconds = parseIntervalSeconds(text);
        if (seconds === null || seconds < 1 || seconds > MAX_DURATION_SECONDS) throw invalid();
        options.interval = text;
        return;
    }
    if (kind === 'limit' || kind === 'tolerance') {
        if (!/^\d+$/.test(text)) throw invalid();
        options[key] = Number(text);
        return;
    }
    throw new ParseAbort(ERROR(line, 'routeRuleErrorUnknownOption', raw));
}

function formatTerm(term) {
    const body = term.kind === 'regex' ? `/${term.pattern}/${term.flags}` : term.text;
    return term.negate ? `-${body}` : body;
}

// Canonical matcher text, used for the generated group name and reuse key.
export function formatClauses(clauses) {
    return clauses.map(clause => clause.map(formatTerm).join('+')).join(',');
}

function parseLine(lineNumber, text) {
    const separator = SEPARATOR_RE.exec(text);
    if (!separator) throw new ParseAbort(ERROR(lineNumber, 'routeRuleErrorMissingSeparator'));

    const conditionTokens = tokenize(text.slice(0, separator.index), lineNumber);
    const tokens = tokenize(text.slice(separator.index + separator[0].length), lineNumber);

    // The first option-shaped token ends the matcher, so everything after it
    // must be a known option: a typo surfaces instead of silently becoming a
    // node name that matches nothing.
    let splitAt = tokens.length;
    for (let index = 0; index < tokens.length; index += 1) {
        if (looksLikeOption(tokens[index])) {
            splitAt = index;
            break;
        }
    }

    const conditions = conditionTokens.map(token => parseCondition(token, lineNumber));
    if (conditions.length === 0) {
        throw new ParseAbort(ERROR(lineNumber, 'routeRuleErrorInvalidCondition', text.slice(0, separator.index).trim()));
    }
    if (conditions.length > MAX_RULE_CONDITIONS) {
        throw new ParseAbort(ERROR(lineNumber, 'routeRuleErrorTooManyConditions', String(MAX_RULE_CONDITIONS)));
    }

    const clauses = parseMatcherTokens(tokens.slice(0, splitAt), lineNumber);
    if (clauses.length === 0) throw new ParseAbort(ERROR(lineNumber, 'routeRuleErrorEmptyTarget'));

    const options = { ...DEFAULT_ROUTE_RULE_OPTIONS };
    for (const token of tokens.slice(splitAt)) {
        const parsed = parseOption(token);
        if (!parsed) throw new ParseAbort(ERROR(lineNumber, 'routeRuleErrorUnknownOption', joinValue(token)));
        applyOption(options, parsed, lineNumber);
    }

    return { line: lineNumber, conditions, clauses, expression: formatClauses(clauses), options };
}

export function parseRouteRules(input) {    const rules = [];
    const errors = [];
    const lines = String(input ?? '').split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index].trim();
        if (text === '' || text.startsWith('#')) continue;
        if (rules.length >= MAX_ROUTE_RULES) {
            errors.push(ERROR(index + 1, 'routeRuleErrorTooManyRules', String(MAX_ROUTE_RULES)));
            break;
        }
        try {
            rules.push(parseLine(index + 1, text));
        } catch (cause) {
            if (!(cause instanceof ParseAbort)) throw cause;
            errors.push(cause.error);
        }
    }

    return { rules, errors };
}

const MAX_REPORTED_ERRORS = 5;

// Errors stay structured so the endpoint can render them in the visitor's
// language; the technical token goes in as `arg` and never needs translating.
export function formatRouteRuleErrors(errors, t) {
    const translate = typeof t === 'function' ? t : (key) => key;
    return errors.slice(0, MAX_REPORTED_ERRORS).map((error) => {
        const message = translate(error.code);
        const detail = error.arg ? `${message}: ${error.arg}` : message;
        return String(translate('routeRuleErrorLine'))
            .replace('{line}', String(error.line))
            .replace('{message}', detail);
    }).join('\n');
}
