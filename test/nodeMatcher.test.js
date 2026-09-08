import { describe, it, expect } from 'vitest';
import { clauseMatches, groupDisplayName, matchNodeTags, ruleDedupKey } from '../src/builders/helpers/nodeMatcher.js';
import { parseRouteRules } from '../src/utils/routeRuleParser.js';

const NODES = ['US-7', 'US-8', '美国-洛杉矶', '美国-水牛城', '日本-东京', 'SG-1'];

// Rules are authored as text so the matcher is tested against the real AST.
function rule(matcherText, options = {}) {
    const optionText = Object.entries(options).map(([key, value]) => `${key}=${value}`).join(' ');
    const { rules, errors } = parseRouteRules(`a.cn => ${matcherText}${optionText ? ` ${optionText}` : ''}`);
    expect(errors).toEqual([]);
    return rules[0];
}

describe('node matcher', () => {
    it('unions keyword alternatives case-insensitively', () => {
        expect(matchNodeTags(NODES, rule('us, 美国').clauses)).toEqual(['US-7', 'US-8', '美国-洛杉矶', '美国-水牛城']);
    });

    it('intersects with + and excludes with -', () => {
        expect(matchNodeTags(NODES, rule('美国+洛杉矶').clauses)).toEqual(['美国-洛杉矶']);
        expect(matchNodeTags(NODES, rule('us,-8').clauses)).toEqual(['US-7']);
        // A leading `-` token narrows the branch it follows, never the whole rule.
        expect(matchNodeTags(NODES, rule('美国+-水牛城').clauses)).toEqual(['美国-洛杉矶']);
        expect(matchNodeTags(NODES, rule('us,美国+-水牛城').clauses)).toEqual(['US-7', 'US-8', '美国-洛杉矶']);
    });

    it('matches regex terms honouring their flags', () => {
        expect(matchNodeTags(NODES, rule('/^us-\\d+$/').clauses)).toEqual([]);
        expect(matchNodeTags(NODES, rule('/^us-\\d+$/i').clauses)).toEqual(['US-7', 'US-8']);
    });

    it('returns nothing when no node matches', () => {
        expect(matchNodeTags(NODES, rule('德国').clauses)).toEqual([]);
    });

    it('sorts and limits the selection', () => {
        expect(matchNodeTags(NODES, rule('us,美国').clauses, { limit: 2 })).toEqual(['US-7', 'US-8']);
        expect(matchNodeTags(NODES, rule('us,美国').clauses, { limit: 2, sort: 'name' })).toEqual(['US-7', 'US-8']);
        // Code-point order, so 水牛城 (U+6C34) sorts before 洛杉矶 (U+6D1B).
        expect(matchNodeTags(NODES, rule('us,美国').clauses, { sort: 'name' })).toEqual(['US-7', 'US-8', '美国-水牛城', '美国-洛杉矶']);
    });

    it('exposes single tag matching', () => {
        expect(clauseMatches('美国-水牛城', rule('美国+水牛城').clauses)).toBe(true);
        expect(clauseMatches('美国-水牛城', rule('美国+东京').clauses)).toBe(false);
    });
});

describe('rule identity', () => {
    it('keys a group by rule text only so tags stay stable across refreshes', () => {
        expect(ruleDedupKey(rule('us,美国'))).toBe(ruleDedupKey({ expression: 'us,美国', options: rule('us,美国').options }));
        expect(ruleDedupKey(rule('us,美国', { limit: 5 }))).not.toBe(ruleDedupKey(rule('us,美国')));
        expect(ruleDedupKey(rule('us,美国', { mode: 'urltest' }))).not.toBe(ruleDedupKey(rule('us,美国')));
    });

    it('names the group after the expression unless overridden', () => {
        expect(groupDisplayName(rule('us,美国'))).toBe('🎯 us,美国');
        expect(groupDisplayName(rule('us,美国', { name: '美区' }))).toBe('美区');
    });
});
