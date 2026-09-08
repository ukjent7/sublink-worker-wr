import { describe, it, expect, afterEach } from 'vitest';
import { formLogicFn } from '../src/components/formLogic.js';

// Alpine is not available here, so the browser globals the form logic touches
// are stubbed and `$watch` registrations are captured instead of executed by a
// reactivity system.
let restoreGlobals = null;

function createScope(saved = {}) {
    const storage = new Map(Object.entries(saved));
    const watched = new Map();
    const names = ['window', 'localStorage', 'alert', 'confirm', 'document', 'fetch'];
    const previous = names.map(name => [name, globalThis[name]]);

    globalThis.window = {
        location: { origin: 'https://sub.example' },
        APP_TRANSLATIONS: { confirmClearAll: 'sure?' }
    };
    globalThis.localStorage = {
        getItem: key => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    };
    globalThis.alert = () => {};
    globalThis.confirm = () => true;
    globalThis.document = { querySelector: () => null };

    restoreGlobals = () => previous.forEach(([name, value]) => { globalThis[name] = value; });

    formLogicFn(() => 'translated');
    const scope = globalThis.window.formData();
    scope.$watch = (key, callback) => watched.set(key, callback);
    scope.init();

    return { scope, storage, watched };
}

afterEach(() => {
    restoreGlobals?.();
    restoreGlobals = null;
});

const CONFIG = 'https://example.com/sub\nss://YWVzLTEyOC1nY206cGFzczEyMw@example.com:8388#US-7';

describe('form logic custom routing', () => {
    it('sends the rules parameter on every generated link', () => {
        const { scope } = createScope();
        scope.input = CONFIG;
        scope.routeRules = 'baidu.com => us, 美国';
        scope.submitForm();

        const params = new URLSearchParams(new URL(scope.generatedLinks.singbox).search);
        expect(params.get('rules')).toBe('baidu.com => us, 美国');
        expect(params.get('config')).toBe(CONFIG);
        for (const link of Object.values(scope.generatedLinks)) {
            expect(link).toContain('rules=baidu');
        }
    });

    it('omits the parameter when the rules box is blank', () => {
        const { scope } = createScope();
        scope.input = CONFIG;
        scope.routeRules = '   \n  ';
        scope.submitForm();

        expect(scope.generatedLinks.singbox).not.toContain('rules=');
        expect(scope.generatedLinks.clash).not.toContain('rules=');
    });

    it('restores saved input and rules on init', () => {
        const { scope } = createScope({ inputTextarea: CONFIG, routeRulesTextarea: 'a.com => us' });
        expect(scope.input).toBe(CONFIG);
        expect(scope.routeRules).toBe('a.com => us');
    });

    it('persists rule edits through its watcher', () => {
        const { scope, storage, watched } = createScope();
        expect(watched.has('routeRules')).toBe(true);
        watched.get('routeRules')('a.com => us');
        expect(storage.get('routeRulesTextarea')).toBe('a.com => us');
    });

    it('clears rules together with the rest of the form', () => {
        const { scope, storage } = createScope({ routeRulesTextarea: 'a.com => us' });
        scope.clearAll();
        expect(scope.routeRules).toBe('');
        expect(storage.has('routeRulesTextarea')).toBe(false);
    });

    it('loads rules back from a shared URL and keeps them when absent', () => {
        const { scope } = createScope();
        scope.populateFormFromUrl(new URL('https://sub.example/singbox?config=abc&rules=a.com%20%3D%3E%20us'));
        expect(scope.input).toBe('abc');
        expect(scope.routeRules).toBe('a.com => us');

        scope.populateFormFromUrl(new URL('https://sub.example/singbox?config=def'));
        expect(scope.routeRules).toBe('a.com => us');
    });
});

describe('form logic link shortening', () => {
    function withFetch(handler) {
        const scope = createScope().scope;
        const calls = [];
        const alerts = [];
        globalThis.fetch = async (url) => {
            calls.push(url);
            return handler(calls.length);
        };
        globalThis.alert = message => alerts.push(message);
        scope.input = CONFIG;
        scope.submitForm();
        return { scope, calls, alerts };
    }

    const okResponse = () => ({ ok: true, status: 200, text: async () => 'AbC1234' });

    it('sends a single request and derives every format from its code', async () => {
        const { scope, calls } = withFetch(okResponse);
        await scope.shortenLinks();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('/shorten-v2?url=');
        expect(scope.shortenedLinks).toEqual({
            xray: 'https://sub.example/x/AbC1234',
            singbox: 'https://sub.example/b/AbC1234',
            clash: 'https://sub.example/c/AbC1234',
            surge: 'https://sub.example/s/AbC1234'
        });
    });

    it('passes a custom short code through once', async () => {
        const { scope, calls } = withFetch(okResponse);
        scope.customShortCode = 'myOwnCode';
        await scope.shortenLinks();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain(`shortCode=${encodeURIComponent('myOwnCode')}`);
    });

    it('reports the backend reason instead of a bare failure', async () => {
        const { scope, alerts } = withFetch(() => ({
            ok: false,
            status: 500,
            text: async () => 'Error: Reached the max retries per request limit (which is 20)'
        }));
        await scope.shortenLinks();

        expect(scope.shortenedLinks).toBeNull();
        expect(alerts[0]).toContain('500');
        expect(alerts[0]).toContain('max retries per request limit');
    });
});
