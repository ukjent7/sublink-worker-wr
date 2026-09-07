import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app/createApp.jsx';
import { MemoryKVAdapter } from '../src/adapters/kv/memoryKv.js';

const createTestApp = (overrides = {}) => {
    const runtime = {
        kv: overrides.kv ?? new MemoryKVAdapter(),
        assetFetcher: overrides.assetFetcher ?? null,
        logger: console,
        config: {
            configTtlSeconds: 60,
            shortLinkTtlSeconds: null,
            ...(overrides.config || {})
        }
    };
    return createApp(runtime);
};

describe('Worker', () => {
    it('GET / returns HTML', async () => {
        const app = createTestApp();
        const res = await app.request('http://localhost/');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        const text = await res.text();
        expect(text).toContain('Sublink Worker');
    });

    it('GET /singbox returns JSON', async () => {
        const app = createTestApp();
        const config = 'vmess://ew0KICAidiI6ICIyIiwNCiAgInBzIjogInRlc3QiLA0KICAiYWRkIjogIjEuMS4xLjEiLA0KICAicG9ydCI6ICI0NDMiLA0KICAiaWQiOiAiYWRkNjY2NjYtODg4OC04ODg4LTg4ODgtODg4ODg4ODg4ODg4IiwNCiAgImFpZCI6ICIwIiwNCiAgInNjeSI6ICJhdXRvIiwNCiAgIm5ldCI6ICJ3cyIsDQogICJ0eXBlIjogIm5vbmUiLA0KICAiaG9zdCI6ICIiLA0KICAicGF0aCI6ICIvIiwNCiAgInRscyI6ICJ0bHMiDQp9';
        const res = await app.request(`http://localhost/singbox?config=${encodeURIComponent(config)}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/json');
        const json = await res.json();
        expect(json).toHaveProperty('outbounds');
    });

    it('GET /singbox keeps the skeleton immutable and only fills outbounds', async () => {
        const app = createTestApp();
        const config = 'vmess://ew0KICAidiI6ICIyIiwNCiAgInBzIjogInRlc3QiLA0KICAiYWRkIjogIjEuMS4xLjEiLA0KICAicG9ydCI6ICI0NDMiLA0KICAiaWQiOiAiYWRkNjY2NjYtODg4OC04ODg4LTg4ODgtODg4ODg4ODg4ODg4IiwNCiAgImFpZCI6ICIwIiwNCiAgIm5ldCI6ICJ3cyIsDQogICJ0eXBlIjogIm5vbmUiLA0KICAiaG9zdCI6ICIiLA0KICAicGF0aCI6ICIvIiwNCiAgInRscyI6ICJ0bHMiDQp9';
        const res = await app.request(`http://localhost/singbox?config=${encodeURIComponent(config)}`);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json?.dns?.final).toBe('remote-dns');
        expect(json?.route?.final).toBe('🌐 全局');
        const tags = (json?.outbounds || []).map(o => o?.tag);
        expect(tags).toContain('direct');
        expect(tags).toContain('block');
        expect(tags).toContain('📌 单节点');
        expect(tags).toContain('🌐 全局');
        expect(tags).toContain('test');
        const singleGroup = (json?.outbounds || []).find(o => o?.tag === '📌 单节点');
        expect(singleGroup?.outbounds).toContain('test');
    });


    it('GET /clash returns YAML', async () => {
        const app = createTestApp();
        const config = 'vmess://ew0KICAidiI6ICIyIiwNCiAgInBzIjogInRlc3QiLA0KICAiYWRkIjogIjEuMS4xLjEiLA0KICAicG9ydCI6ICI0NDMiLA0KICAiaWQiOiAiYWRkNjY2NjYtODg4OC04ODg4LTg4ODgtODg4ODg4ODg4ODg4IiwNCiAgImFpZCI6ICIwIiwNCiAgInNjeSI6ICJhdXRvIiwNCiAgIm5ldCI6ICJ3cyIsDQogICJ0eXBlIjogIm5vbmUiLA0KICAiaG9zdCI6ICIiLA0KICAicGF0aCI6ICIvIiwNCiAgInRscyI6ICJ0bHMiDQp9';
        const res = await app.request(`http://localhost/clash?config=${encodeURIComponent(config)}`);
        expect(res.status).toBe(200);
        // Clash builder returns text/yaml
        expect(res.headers.get('content-type')).toContain('text/yaml');
        const text = await res.text();
        expect(text).toContain('proxies:');
    });

    it('GET /clash fills proxies and ignores pasted proxy-groups', async () => {
        const app = createTestApp();
        const config = `
proxies:
  - name: Node-A
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
proxy-groups:
  - name: Empty Test Group
    type: url-test
    proxies: []
`;
        const res = await app.request(`http://localhost/clash?config=${encodeURIComponent(config)}`);

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('Node-A');
        expect(text).not.toContain('Empty Test Group');
    });

    it('GET /shorten-v2 returns short code', async () => {
        const url = 'http://example.com';
        const kvMock = {
            put: vi.fn(async () => {}),
            get: vi.fn(async () => null),
            delete: vi.fn(async () => {})
        };
        const app = createTestApp({ kv: kvMock });
        const res = await app.request(`http://localhost/shorten-v2?url=${encodeURIComponent(url)}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBeTruthy();
        expect(kvMock.put).toHaveBeenCalled();
    });
});
