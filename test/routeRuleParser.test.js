import { describe, it, expect } from 'vitest';
import { formatClauses, parseRouteRules, MAX_ROUTE_RULES } from '../src/utils/routeRuleParser.js';

const firstRule = (text) => {
    const { rules, errors } = parseRouteRules(text);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
    return rules[0];
};

const errorCodes = (text) => parseRouteRules(text).errors.map(error => error.code);

describe('route rule parser: conditions', () => {
    it('maps bare, wildcard and dotted domains to domain_suffix', () => {
        const rule = firstRule('baidu.com, *.youtube.com, .qq.com => us');
        expect(rule.conditions).toEqual([
            { type: 'domain_suffix', value: 'baidu.com' },
            { type: 'domain_suffix', value: 'youtube.com' },
            { type: 'domain_suffix', value: 'qq.com' }
        ]);
    });

    it('keeps =exact as domain and lowercases values', () => {
        const rule = firstRule('=Exact.Example.COM => us');
        expect(rule.conditions).toEqual([{ type: 'domain', value: 'exact.example.com' }]);
    });

    it('treats ~ as domain_regex and lets it contain commas', () => {
        const rule = firstRule('~\\.(tv|me)$, baidu.com => us');
        expect(rule.conditions).toEqual([
            { type: 'domain_regex', value: '\\.(tv|me)$' },
            { type: 'domain_suffix', value: 'baidu.com' }
        ]);
    });

    it('recognises IPv4, CIDR and IPv6 conditions', () => {
        const rule = firstRule('8.8.8.8, 1.2.3.0/24, fd00::/8 => us');
        expect(rule.conditions).toEqual([
            { type: 'ip_cidr', value: '8.8.8.8' },
            { type: 'ip_cidr', value: '1.2.3.0/24' },
            { type: 'ip_cidr', value: 'fd00::/8' }
        ]);
    });

    it('rejects values that are neither a hostname nor an address', () => {
        expect(errorCodes('not a domain => us')).toEqual(['routeRuleErrorInvalidCondition']);
        expect(errorCodes('1.2.3.400 => us')).toEqual(['routeRuleErrorInvalidCondition']);
        expect(errorCodes('1.2.3.0/33 => us')).toEqual(['routeRuleErrorInvalidCondition']);
        expect(errorCodes('=> us')).toEqual(['routeRuleErrorInvalidCondition']);
    });

    it('tolerates Chinese punctuation and pasted links (toddler-proof)', () => {
        // 原 400 案例：中文逗号不再炸
        expect(firstRule('dmm.co.jp，dlsite.com => 日本').conditions).toEqual([
            { type: 'domain_suffix', value: 'dmm.co.jp' },
            { type: 'domain_suffix', value: 'dlsite.com' }
        ]);
        expect(firstRule('dmm.co.jp、dlsite.com => 日本').conditions).toHaveLength(2);
        expect(firstRule('dmm.co.jp；dlsite.com => 日本').conditions).toHaveLength(2);
        // 直接粘贴链接自动取域名
        expect(firstRule('https://www.dlsite.com/home?a=1 => 日本').conditions).toEqual([
            { type: 'domain_suffix', value: 'www.dlsite.com' }
        ]);
        // 全角箭头 / 全角加号 / 全角等号
        expect(firstRule('dmm.co.jp ＝＞ 日本').expression).toBe('日本');
        expect(firstRule('a.cn => 日本＋东京').clauses[0].map((t) => t.text)).toEqual(['日本', '东京']);
        expect(firstRule('a.cn => us mode＝urltest').options.mode).toBe('urltest');
    });
});

describe('route rule parser: node matcher', () => {
    it("treats comma and whitespace as OR", () => {
        const rule = firstRule('a.cn => us, 美国');
        const spaced = firstRule('a.cn => us 美国');
        expect(rule.clauses).toEqual([[{ negate: false, kind: 'keyword', text: 'us' }], [{ negate: false, kind: 'keyword', text: '美国' }]]);
        expect(spaced.clauses).toEqual(rule.clauses);
    });

    it("treats + as AND", () => {
        const rule = firstRule('a.cn => 美国+洛杉矶');
        expect(rule.clauses).toHaveLength(1);
        expect(rule.clauses[0].map(term => term.text)).toEqual(['美国', '洛杉矶']);
    });

    it('attaches a leading negation to the previous branch', () => {
        const rule = firstRule('a.cn => us,-到期');
        expect(rule.clauses).toHaveLength(1);
        expect(rule.clauses[0]).toEqual([
            { negate: false, kind: 'keyword', text: 'us' },
            { negate: true, kind: 'keyword', text: '到期' }
        ]);
    });

    it('supports quoted terms and regex terms with flags', () => {
        const rule = firstRule('a.cn => "los angeles", /^US-\\d+$/i');
        expect(rule.clauses).toEqual([
            [{ negate: false, kind: 'keyword', text: 'los angeles' }],
            [{ negate: false, kind: 'regex', pattern: '^US-\\d+$', flags: 'i' }]
        ]);
        expect(rule.expression).toBe('los angeles,/^US-\\d+$/i');
    });

    it('keeps separators inside quoted and regex terms', () => {
        const rule = firstRule('a.cn => /a,b/, "c+d"');
        expect(rule.clauses).toEqual([
            [{ negate: false, kind: 'regex', pattern: 'a,b', flags: '' }],
            [{ negate: false, kind: 'keyword', text: 'c+d' }]
        ]);
    });

    it('round-trips the canonical expression used for group naming', () => {
        expect(formatClauses(firstRule('a.cn => 美国+洛杉矶,-到期').clauses)).toBe('美国+洛杉矶+-到期');
    });

    it('reports malformed matchers', () => {
        expect(errorCodes('a.cn =>')).toEqual(['routeRuleErrorEmptyTarget']);
        expect(errorCodes('a.cn => us,"broken')).toEqual(['routeRuleErrorUnterminated']);
        expect(errorCodes('a.cn => us,/broken')).toEqual(['routeRuleErrorUnterminated']);
        expect(errorCodes('a.cn => /us(/')).toEqual(['routeRuleErrorInvalidRegex']);
        expect(errorCodes('a.cn')).toEqual(['routeRuleErrorMissingSeparator']);
    });
});

describe('route rule parser: options', () => {
    it('applies the documented defaults', () => {
        const rule = firstRule('a.cn => us');
        expect(rule.options).toEqual({
            mode: 'selector', name: '', limit: 0, sort: 'input', fallback: 'none', url: '', interval: '', tolerance: 0
        });
    });

    it('accepts the separator arrow form and every option key', () => {
        const rule = firstRule('a.cn -> us mode=urltest limit=8 sort=name name="My Group" interval=5m tolerance=120 url=https://example.com/204');
        expect(rule.options).toMatchObject({
            mode: 'urltest', limit: 8, sort: 'name', name: 'My Group', interval: '5m', tolerance: 120, url: 'https://example.com/204'
        });
    });

    it('stops the matcher at the first option token', () => {
        const rule = firstRule('a.cn => us,美国 mode=both');
        expect(rule.expression).toBe('us,美国');
        expect(rule.options.mode).toBe('both');
    });

    it('rejects unknown or malformed options instead of matching them', () => {
        expect(errorCodes('a.cn => us mod=both')).toEqual(['routeRuleErrorUnknownOption']);
        expect(errorCodes('a.cn => us mode=fast')).toEqual(['routeRuleErrorInvalidOption']);
        expect(errorCodes('a.cn => us limit=abc')).toEqual(['routeRuleErrorInvalidOption']);
        expect(errorCodes('a.cn => us interval=30x')).toEqual(['routeRuleErrorInvalidOption']);
        expect(errorCodes('a.cn => us url=example.com')).toEqual(['routeRuleErrorInvalidOption']);
        expect(errorCodes('a.cn => us name=')).toEqual(['routeRuleErrorInvalidOption']);
    });

    it('skips comments and blank lines', () => {
        const { rules, errors } = parseRouteRules('# 注释\n\na.cn => us\n   \n# done');
        expect(errors).toEqual([]);
        expect(rules).toHaveLength(1);
    });

    it('collects errors with their line numbers', () => {
        const { rules, errors } = parseRouteRules('a.cn => us\nbroken\nb.cn => 美国\nc.cn => us mode=nope');
        expect(rules).toHaveLength(2);
        expect(errors).toEqual([
            { line: 2, code: 'routeRuleErrorMissingSeparator', arg: '' },
            { line: 4, code: 'routeRuleErrorInvalidOption', arg: 'mode=nope' }
        ]);
    });

    it('caps the number of rules', () => {
        const text = Array.from({ length: MAX_ROUTE_RULES + 5 }, (_, index) => `h${index}.cn => us`).join('\n');
        const { rules, errors } = parseRouteRules(text);
        expect(rules).toHaveLength(MAX_ROUTE_RULES);
        expect(errors.at(-1).code).toBe('routeRuleErrorTooManyRules');
    });
});
