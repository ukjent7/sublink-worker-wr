import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the fetcher so no network is needed
vi.mock('../src/parsers/subscription/httpSubscriptionFetcher.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        fetchSubscriptionWithFormat: vi.fn()
    };
});

import { fetchSubscriptionWithFormat } from '../src/parsers/subscription/httpSubscriptionFetcher.js';
import { SingboxConfigBuilder } from '../src/builders/SingboxConfigBuilder.js';
import { SING_BOX_CONFIG } from '../src/config/index.js';

const SUB1_A = 'ss://YWVzLTEyOC1nY206cGFzczEyMw@example.com:8388#Sub1-A';
const SUB1_B = 'ss://YWVzLTEyOC1nY206cGFzczEyMw@example.com:8389#Sub1-B';
const SUB2_A = 'ss://YWVzLTEyOC1nY206cGFzczEyMw@example.com:8390#Sub2-A';
const SINGLE_1 = 'ss://YWVzLTEyOC1nY206cGFzczEyMw@example.com:8391#Single-1';

describe('Sing-Box fill-only behavior', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('fills each subscription into its own group and singles into the single group', async () => {
        fetchSubscriptionWithFormat.mockImplementation(async (url) => {
            if (url === 'https://example.com/sub1') {
                return { content: `${SUB1_A}\n${SUB1_B}`, format: 'unknown', url };
            }
            if (url === 'https://example.com/sub2') {
                return { content: SUB2_A, format: 'unknown', url };
            }
            return null;
        });

        const input = ['https://example.com/sub1', 'https://example.com/sub2', SINGLE_1].join('\n');
        const builder = new SingboxConfigBuilder(input);
        const result = await builder.build();

        // Skeleton sections stay untouched
        expect(result.dns).toEqual(SING_BOX_CONFIG.dns);
        expect(result.route).toEqual(SING_BOX_CONFIG.route);
        expect(result.inbounds).toEqual(SING_BOX_CONFIG.inbounds);
        expect(result.log).toEqual(SING_BOX_CONFIG.log);
        expect(result.http_clients).toEqual(SING_BOX_CONFIG.http_clients);
        expect(result.experimental).toEqual(SING_BOX_CONFIG.experimental);
        expect(result).not.toHaveProperty('outbound_providers');

        const byTag = new Map((result.outbounds || []).map(o => [o?.tag, o]));

        // Single nodes fill the single group
        expect(byTag.get('📌 单节点')?.outbounds).toEqual(['Single-1']);

        // Each subscription fills its own group
        expect(byTag.get('✈️ 订阅01')?.outbounds).toEqual(['Sub1-A', 'Sub1-B']);
        expect(byTag.get('✈️ 订阅02')?.outbounds).toEqual(['Sub2-A']);

        // The aggregate group only gains the new group references
        expect(byTag.get('🌐 全局')?.outbounds).toEqual(['📌 单节点', '✈️ 订阅01', '✈️ 订阅02', 'direct']);
        expect(byTag.get('🌐 全局')?.default).toBe('📌 单节点');

        // Group order: direct, block, nodes, proxy, single group, subscription groups
        expect((result.outbounds || []).map((o) => o?.tag)).toEqual([
            'direct',
            'block',
            'Single-1',
            'Sub1-A',
            'Sub1-B',
            'Sub2-A',
            '🌐 全局',
            '📌 单节点',
            '✈️ 订阅01',
            '✈️ 订阅02',
        ]);

        // Node entries are appended, existing entries are intact
        expect(byTag.get('direct')).toEqual({ type: 'direct', tag: 'direct', domain_resolver: 'direct-dns' });
        expect(byTag.get('block')).toEqual({ type: 'block', tag: 'block' });
        expect(byTag.get('Sub1-A')?.server).toBe('example.com');
    });
});
