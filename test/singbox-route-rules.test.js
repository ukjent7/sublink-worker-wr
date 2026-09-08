import { describe, it, expect } from 'vitest';
import { SingboxConfigBuilder } from '../src/builders/SingboxConfigBuilder.js';
import { parseRouteRules } from '../src/utils/routeRuleParser.js';
import { SING_BOX_CONFIG } from '../src/config/index.js';

const node = (tag) => `ss://YWVzLTEyOC1nY206cGFzczEyMw@example.com:8388#${encodeURIComponent(tag)}`;
const INPUT = ['US-7', 'US-8', '美国-洛杉矶', '美国-水牛城', '日本-东京', '到期提醒'].map(node).join('\n');

const SKELETON_RULES = SING_BOX_CONFIG.route.rules.length;

async function build(rulesText, input = INPUT) {
    const { rules, errors } = parseRouteRules(rulesText);
    expect(errors).toEqual([]);
    const builder = new SingboxConfigBuilder(input, 'zh-CN', { routeRules: rules });
    const config = await builder.build();
    const extra = config.route.rules.length - SKELETON_RULES;
    // Custom rules are inserted after the leading sniff action, so the block
    // of `extra` rules at index 1 is what the feature produced.
    return {
        config,
        byTag: Object.fromEntries(config.outbounds.map(outbound => [outbound.tag, outbound])),
        userRules: config.route.rules.slice(1, 1 + extra)
    };
}

describe('sing-box custom route rules', () => {
    it('leaves the skeleton untouched when no rules are given', async () => {
        const builder = new SingboxConfigBuilder(INPUT, 'zh-CN');
        const config = await builder.build();
        expect(config.route).toEqual(SING_BOX_CONFIG.route);
        expect(config.outbounds.filter(outbound => outbound.tag?.startsWith('🎯'))).toEqual([]);
    });

    it('builds a selector group from keyword alternatives', async () => {
        const { config, byTag, userRules } = await build('baidu.com, qq.com => us, 美国');

        expect(byTag['🎯 us,美国']).toMatchObject({
            type: 'selector',
            outbounds: ['US-7', 'US-8', '美国-洛杉矶', '美国-水牛城'],
            default: 'US-7'
        });
        expect(userRules).toEqual([{ domain_suffix: ['baidu.com', 'qq.com'], outbound: '🎯 us,美国' }]);
        // Custom rules must win over the built-in `geosite-cn -> direct`.
        expect(config.route.rules[0].action).toBe('sniff');
    });

    it('reuses one group for identical matchers', async () => {
        const { config, userRules } = await build('a.com => us\nb.com => us\nc.com => us mode=selector');
        expect(config.outbounds.filter(outbound => outbound.tag?.startsWith('🎯'))).toHaveLength(1);
        expect(userRules).toEqual([
            { domain_suffix: ['a.com', 'b.com', 'c.com'], outbound: '🎯 us' }
        ]);
    });

    it('drops the rule when nothing matches and fallback is none', async () => {
        const { config, userRules } = await build('a.com => 德国');
        expect(userRules).toEqual([]);
        expect(config.outbounds.some(outbound => outbound.tag?.startsWith('🎯'))).toBe(false);
    });

    it('honours fallback=global and fallback=direct', async () => {
        const { userRules } = await build('a.com => 德国 fallback=global\nb.com => 韩国 fallback=direct');
        expect(userRules).toEqual([
            { domain_suffix: ['a.com'], outbound: '🌐 全局' },
            { domain_suffix: ['b.com'], outbound: 'direct' }
        ]);
    });

    it('targets existing outbounds without creating a group', async () => {
        const { config, userRules } = await build('x.com => direct\ny.com => 日本-东京\nz.com => global');
        expect(config.outbounds.some(outbound => outbound.tag?.startsWith('🎯'))).toBe(false);
        expect(userRules).toEqual([
            { domain_suffix: ['x.com'], outbound: 'direct' },
            { domain_suffix: ['y.com'], outbound: '日本-东京' },
            { domain_suffix: ['z.com'], outbound: '🌐 全局' }
        ]);
    });

    it('excludes group and built-in outbounds from the keyword pool', async () => {
        // `全局`/`单节点` are skeleton group tags and must never become members.
        const { byTag } = await build('a.com => 全局, 单节点, us, 日本');
        expect(byTag['🎯 全局,单节点,us,日本'].outbounds).toEqual(['US-7', 'US-8', '日本-东京']);
    });

    it('emits one rule per condition type and dedupes shared targets', async () => {
        const { userRules } = await build('a.com, 8.8.8.8 => us\nb.com, 8.8.8.8 => us');
        expect(userRules).toEqual([
            { domain_suffix: ['a.com', 'b.com'], outbound: '🎯 us' },
            { ip_cidr: ['8.8.8.8'], outbound: '🎯 us' }
        ]);
    });

    it('supports exact domains and regex domains', async () => {
        const { userRules } = await build('=Exact.Example.cn => us\n~\\.(tv|me)$ => 日本');
        expect(userRules).toEqual([
            { domain: ['exact.example.cn'], outbound: '🎯 us' },
            { domain_regex: ['\\.(tv|me)$'], outbound: '🎯 日本' }
        ]);
    });

    it('builds urltest groups and raises idle_timeout for long intervals', async () => {
        const { byTag } = await build('a.com => us mode=urltest interval=10m tolerance=80\nb.com => 日本 mode=urltest interval=2h');
        expect(byTag['🎯 us']).toEqual({
            type: 'urltest',
            tag: '🎯 us',
            outbounds: ['US-7', 'US-8'],
            interval: '10m',
            tolerance: 80
        });
        expect(byTag['🎯 日本']).toMatchObject({ type: 'urltest', interval: '2h', idle_timeout: '2h' });
        expect(byTag['🎯 日本']).not.toHaveProperty('url');
    });

    it('nests a urltest group inside the selector for mode=both', async () => {
        const { byTag, userRules } = await build('a.com => us,日本 mode=both');
        expect(byTag['🎯 us,日本 · 自动']).toMatchObject({ type: 'urltest', outbounds: ['US-7', 'US-8', '日本-东京'] });
        expect(byTag['🎯 us,日本']).toMatchObject({
            type: 'selector',
            outbounds: ['🎯 us,日本 · 自动', 'US-7', 'US-8', '日本-东京'],
            default: '🎯 us,日本 · 自动'
        });
        expect(userRules[0].outbound).toBe('🎯 us,日本');
    });

    it('applies limit and sort', async () => {
        const { byTag } = await build('a.com => us,美国 limit=2 sort=name');
        expect(byTag['🎯 us,美国'].outbounds).toEqual(['US-7', 'US-8']);
        const unlimited = await build('a.com => us,美国 sort=name');
        expect(unlimited.byTag['🎯 us,美国'].outbounds).toEqual(['US-7', 'US-8', '美国-水牛城', '美国-洛杉矶']);
    });

    it('suffices the group tag when a node already uses that name', async () => {
        const input = [node('🎯 us'), node('US-9')].join('\n');
        const { byTag, userRules } = await build('a.com => us', input);
        expect(byTag['🎯 us'].type).toBe('shadowsocks');
        expect(byTag['🎯 us_2']).toMatchObject({ type: 'selector', outbounds: ['🎯 us', 'US-9'] });
        expect(userRules[0].outbound).toBe('🎯 us_2');
    });

    it('keeps the group tag stable while the membership changes', async () => {
        const first = await build('a.com => us');
        const second = await build('a.com => us', [node('US-7'), node('US-300')].join('\n'));
        expect(second.userRules[0].outbound).toBe(first.userRules[0].outbound);
        expect(second.byTag['🎯 us'].outbounds).toEqual(['US-7', 'US-300']);
    });

    it('lets an explicit name override the generated tag', async () => {
        const { byTag, userRules } = await build('a.com => us,美国 name=美区出口');
        expect(byTag['美区出口']).toMatchObject({ type: 'selector', default: 'US-7' });
        expect(userRules[0].outbound).toBe('美区出口');
    });

    it('matches regex terms and negations against the final tags', async () => {
        const { byTag } = await build('a.com => /^us-\\d+$/i,美国+-提醒');
        expect(byTag['🎯 /^us-\\d+$/i,美国+-提醒'].outbounds).toEqual(['US-7', 'US-8', '美国-洛杉矶', '美国-水牛城']);
    });
});
