import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { fetchSubscriptionWithFormat } from '../src/parsers/subscription/httpSubscriptionFetcher.js';
import { encodeBase64 } from '../src/utils.js';

const plainClashYaml = `proxies:
  - name: HK-Plain
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: test123
`;

function mockFetchText(text) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => text,
        headers: {
            get: () => null
        }
    })));
}

function expectNoEmptyUrlTestGroup(config) {
    const emptyUrlTestGroups = (config['proxy-groups'] || []).filter(group =>
        group?.type === 'url-test' &&
        (!Array.isArray(group.proxies) || group.proxies.length === 0) &&
        (!Array.isArray(group.use) || group.use.length === 0)
    );

    expect(emptyUrlTestGroups).toEqual([]);
}

describe('Issues #370/#373/#277 - remote subscription decode and empty Clash output', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps plain Clash YAML intact when fetching remote subscriptions', async () => {
        mockFetchText(plainClashYaml);

        const result = await fetchSubscriptionWithFormat('https://example.com/plain-clash.yaml', 'test-agent');

        expect(result.format).toBe('clash');
        expect(result.content).toBe(plainClashYaml.trim());
        expect(result.content).toContain('HK-Plain');
    });

    it('still decodes Base64 wrapped Clash YAML when fetching remote subscriptions', async () => {
        mockFetchText(encodeBase64(plainClashYaml));

        const result = await fetchSubscriptionWithFormat('https://example.com/base64-clash', 'test-agent');

        expect(result.format).toBe('clash');
        expect(result.content).toBe(plainClashYaml.trim());
        expect(result.content).toContain('HK-Plain');
    });

});
