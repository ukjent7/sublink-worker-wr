export const formLogicFn = (t) => {
    window.formData = function () {
        return {
            input: '',
            routeRules: '',
            loading: false,
            generatedLinks: null,
            shortenedLinks: null,
            shortening: false,
            customShortCode: '',
            parsingUrl: false,
            parseDebounceTimer: null,
            processingText: '',
            convertText: '',
            shortenLinksText: '',
            shorteningText: '',
            showFullLinksText: '',
            // ---- 三岁版分流卡片 ----
            routeCards: [],
            routeCardsNextId: 1,
            expertMode: false,
            expertText: '',

            init() {
                if (window.APP_TRANSLATIONS) {
                    this.processingText = window.APP_TRANSLATIONS.processing;
                    this.convertText = window.APP_TRANSLATIONS.convert;
                    this.shortenLinksText = window.APP_TRANSLATIONS.shortenLinks;
                    this.shorteningText = window.APP_TRANSLATIONS.shortening;
                    this.showFullLinksText = window.APP_TRANSLATIONS.showFullLinks;
                }
                this.input = localStorage.getItem('inputTextarea') || '';
                this.customShortCode = localStorage.getItem('customShortCode') || '';
                this.expertMode = localStorage.getItem('routeExpertMode') === '1';
                this.expertText = localStorage.getItem('routeExpertText') || '';
                // 新版卡片优先，其次兼容老版 routeRulesTextarea
                let restored = false;
                try {
                    const saved = JSON.parse(localStorage.getItem('routeCardsV1') || 'null');
                    if (Array.isArray(saved) && saved.length) {
                        this.routeCards = saved.map((c) => ({
                            id: this.routeCardsNextId++,
                            domains: String(c.domains || ''),
                            preset: c.preset || '',
                            customTarget: String(c.customTarget || '')
                        }));
                        restored = true;
                    }
                } catch { /* 坏缓存就丢掉 */ }
                const legacy = localStorage.getItem('routeRulesTextarea') || '';
                if (!restored && legacy.trim() !== '') {
                    const parsed = this.parseTextToCards(legacy);
                    if (parsed.length) {
                        this.routeCards = parsed;
                    } else {
                        // 老文本太复杂，转进高手模式保底，不丢数据
                        this.expertMode = true;
                        this.expertText = legacy;
                    }
                }
                if (!restored && !this.routeCards.length && !this.expertMode) {
                    this.routeCards = [{ id: this.routeCardsNextId++, domains: '', preset: '', customTarget: '' }];
                }
                this.routeRules = legacy;
                this.syncRulesFromCards(false);
                if (this.expertMode && this.expertText.trim() !== '') {
                    this.routeRules = this.expertText;
                }

                this.$watch('input', val => {
                    localStorage.setItem('inputTextarea', val);
                    this.handleInputChange(val);
                });
                this.$watch('customShortCode', val => localStorage.setItem('customShortCode', val));
                this.$watch('expertMode', val => localStorage.setItem('routeExpertMode', val ? '1' : '0'));
                this.$watch('expertText', val => {
                    localStorage.setItem('routeExpertText', val);
                    if (this.expertMode) {
                        this.routeRules = val;
                        localStorage.setItem('routeRulesTextarea', val);
                    }
                });
                this.$watch('routeRules', val => localStorage.setItem('routeRulesTextarea', val));
            },

            // ---------- 小白核心：域名清洗（和后端同逻辑，前端先拦） ----------
            cleanDomains(rawText) {
                const text = String(rawText || '');
                // 中文逗号顿号分号竖线全当分隔，换行也行
                const parts = text.split(/[,\uFF0C\u3001\uFF1B;；｜|、\s]+/);
                const good = [];
                const bad = [];
                const seen = new Set();
                const HOSTNAME_RE = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}\-_]*[\p{L}\p{N}])?\.)+[\p{L}\p{N}](?:[\p{L}\p{N}\-_]*[\p{L}\p{N}])?$/u;
                const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
                for (let piece of parts) {
                    piece = String(piece || '').trim();
                    if (!piece) continue;
                    // 粘贴链接自动取域名
                    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(piece)) {
                        try { piece = new URL(piece).hostname || piece; } catch { /* 保留原样报错 */ }
                    }
                    piece = piece.split('/')[0].split('?')[0].split('#')[0].trim();
                    piece = piece.replace(/^[*.\s]+/, '');
                    if (!piece) continue;
                    // 带端口的去掉端口
                    if (/^[^:]+:\d+$/.test(piece)) piece = piece.slice(0, piece.lastIndexOf(':'));
                    const lower = piece.toLowerCase();
                    let ok = false;
                    if (IPV4_RE.test(piece)) {
                        ok = piece.split('.').every((p) => Number(p) <= 255);
                    } else if (piece.includes(':')) {
                        ok = /^[0-9a-f:.]+$/i.test(piece);
                        if (ok && piece.includes('/')) {
                            const n = Number(piece.split('/')[1]);
                            ok = Number.isInteger(n) && n <= 128;
                        }
                    } else {
                        const withPrefix = piece.includes('/') ? piece.split('/')[0] : piece;
                        ok = HOSTNAME_RE.test(lower.replace(/^(\*\.\?|\.)/, '')) || HOSTNAME_RE.test(withPrefix);
                        if (piece.includes('/')) {
                            const [h, p] = piece.split('/');
                            ok = HOSTNAME_RE.test(h.toLowerCase()) && /^\d{1,3}$/.test(p || '') && Number(p) <= 32;
                        } else {
                            ok = HOSTNAME_RE.test(lower);
                        }
                    }
                    if (ok) {
                        if (!seen.has(lower)) { seen.add(lower); good.push(lower); }
                    } else {
                        if (!bad.includes(piece)) bad.push(piece);
                    }
                }
                return { good, bad };
            },

            cardTarget(card) {
                if (!card) return '';
                if (card.preset === '__custom') return String(card.customTarget || '').trim();
                if (card.preset === '__direct') return 'direct';
                if (card.preset === '__block') return 'block';
                return String(card.preset || '').trim();
            },

            cardPreview(card) {
                const { good } = this.cleanDomains(card.domains);
                const target = this.cardTarget(card);
                if (!good.length || !target) return '';
                return `${good.join(', ')} => ${target}`;
            },

            cardStatus(card) {
                const raw = String(card.domains || '').trim();
                const target = this.cardTarget(card);
                const t = window.APP_TRANSLATIONS || {};
                if (!raw && !target) return { ok: false, empty: true, text: t.customRoutesEmpty || '' };
                const { good, bad } = this.cleanDomains(card.domains);
                if (!good.length) return { ok: false, text: t.customRoutesNeedSites || '先填网站' };
                if (!target) return { ok: false, text: t.customRoutesNeedTarget || '再选线路' };
                if (bad.length) return { ok: true, warn: true, text: `${t.customRoutesBadSite || ''}${bad.slice(0, 3).join('、')}` };
                return { ok: true, text: t.customRoutesOk || '✓' };
            },

            buildRulesFromCards() {
                const lines = [];
                for (const card of this.routeCards) {
                    const line = this.cardPreview(card);
                    if (line) lines.push(line);
                }
                return lines.join('\n');
            },

            syncRulesFromCards(save = true) {
                if (this.expertMode) return;
                this.routeRules = this.buildRulesFromCards();
                if (save) {
                    localStorage.setItem('routeRulesTextarea', this.routeRules);
                    try {
                        localStorage.setItem('routeCardsV1', JSON.stringify(
                            this.routeCards.map((c) => ({ domains: c.domains, preset: c.preset, customTarget: c.customTarget }))
                        ));
                    } catch { /* 配额满就跳过 */ }
                }
            },

            onCardInput() {
                this.syncRulesFromCards(true);
            },

            addRouteCard(domains = '', preset = '') {
                this.routeCards.push({ id: this.routeCardsNextId++, domains, preset, customTarget: '' });
                this.onCardInput();
            },

            removeRouteCard(index) {
                this.routeCards.splice(index, 1);
                if (!this.routeCards.length) {
                    this.routeCards.push({ id: this.routeCardsNextId++, domains: '', preset: '', customTarget: '' });
                }
                this.onCardInput();
            },

            setCardPreset(index, preset) {
                const card = this.routeCards[index];
                if (!card) return;
                card.preset = preset;
                if (preset !== '__custom') card.customTarget = '';
                this.onCardInput();
            },

            useTemplateDmm() {
                // 有空卡就填它，没空卡就新建
                const empty = this.routeCards.find((c) => !String(c.domains || '').trim());
                if (empty) {
                    empty.domains = 'dmm.co.jp\ndlsite.com';
                    empty.preset = '日本';
                } else {
                    this.routeCards.push({ id: this.routeCardsNextId++, domains: 'dmm.co.jp\ndlsite.com', preset: '日本', customTarget: '' });
                }
                this.onCardInput();
            },

            useTemplateMedia() {
                const empty = this.routeCards.find((c) => !String(c.domains || '').trim());
                if (empty) {
                    empty.domains = 'youtube.com\ngooglevideo.com\nnetflix.com';
                    empty.preset = '美国';
                } else {
                    this.routeCards.push({ id: this.routeCardsNextId++, domains: 'youtube.com\ngooglevideo.com\nnetflix.com', preset: '美国', customTarget: '' });
                }
                this.onCardInput();
            },

            // 老文本（含 => 高级语法）尽力转成卡片，转不成返回 [] 让上层进高手模式
            parseTextToCards(text) {
                const cards = [];
                const lines = String(text || '').split(/\r?\n/);
                for (const line of lines) {
                    const s = line.trim();
                    if (!s || s.startsWith('#')) continue;
                    const m = s.split(/=>|->|＝＞|＝>|=＞|→|—＞/);
                    if (m.length < 2) return [];
                    const left = m[0].trim();
                    const right = m.slice(1).join('=>').trim();
                    if (!left || !right) return [];
                    // 右边太复杂（含 + / - / mode= / 引号 / 正则）就不转卡片了
                    if (/[+＋]/.test(right) || /\s-[^\s]/.test(` ${right}`) || /\//.test(right) || /\"/.test(right) || /\b(mode|limit|sort|name|fallback|url|interval|tolerance)\s*=/i.test(right)) return [];
                    const firstTarget = right.split(/[,，、；;\s]+/).filter(Boolean)[0] || '';
                    if (!firstTarget || /\b(mode|limit|sort|name|fallback|url|interval|tolerance)\s*=/i.test(firstTarget)) return [];
                    const { good, bad } = this.cleanDomains(left);
                    if (bad.length) return [];
                    let preset = firstTarget;
                    let customTarget = '';
                    const low = firstTarget.toLowerCase();
                    if (low === 'direct') preset = '__direct';
                    else if (low === 'block') preset = '__block';
                    else if (['日本', '美国', '香港', '新加坡'].includes(firstTarget)) preset = firstTarget;
                    else { preset = '__custom'; customTarget = firstTarget; }
                    cards.push({
                        id: this.routeCardsNextId++,
                        domains: good.join('\n'),
                        preset,
                        customTarget
                    });
                    if (cards.length >= 50) break;
                }
                return cards;
            },

            effectiveRulesText() {
                if (this.expertMode) return String(this.expertText || '').trim();
                return String(this.routeRules || '').trim();
            },

            clearAll() {
                if (confirm(window.APP_TRANSLATIONS.confirmClearAll)) {
                    this.input = '';
                    this.routeRules = '';
                    this.expertText = '';
                    this.routeCards = [{ id: this.routeCardsNextId++, domains: '', preset: '', customTarget: '' }];
                    this.generatedLinks = null;
                    this.shortenedLinks = null;
                    this.customShortCode = '';
                    localStorage.removeItem('customShortCode');
                    localStorage.removeItem('routeRulesTextarea');
                    localStorage.removeItem('routeCardsV1');
                    localStorage.removeItem('routeExpertText');
                }
            },

            async submitForm() {
                // 前端先拦：有坏卡就用人话提示，不让它走到 400
                if (!this.expertMode) {
                    const built = this.buildRulesFromCards().trim();
                    // 卡片有内容就以卡片为准；卡片全空则保留 routeRules（兼容老测试/老链接直接赋值）。
                    if (built !== '') {
                        this.routeRules = this.buildRulesFromCards();
                        try {
                            localStorage.setItem('routeRulesTextarea', this.routeRules);
                            localStorage.setItem('routeCardsV1', JSON.stringify(
                                this.routeCards.map((c) => ({ domains: c.domains, preset: c.preset, customTarget: c.customTarget }))
                            ));
                        } catch { /* 配额满就跳过 */ }
                    }
                    for (let i = 0; i < this.routeCards.length; i++) {
                        const card = this.routeCards[i];
                        const raw = String(card.domains || '').trim();
                        const target = this.cardTarget(card);
                        if (!raw && !target) continue;
                        const { good, bad } = this.cleanDomains(card.domains);
                        const t = window.APP_TRANSLATIONS || {};
                        if (bad.length) {
                            alert(`第 ${i + 1} 条看不懂：${bad.slice(0, 3).join('、')}，已自动忽略，改对再试。中文逗号、链接都能直接粘。`);
                            return;
                        }
                        if (!good.length) {
                            alert(`第 ${i + 1} 条：${t.customRoutesNeedSites || '先填网站'}`);
                            return;
                        }
                        if (!target) {
                            alert(`第 ${i + 1} 条：${t.customRoutesNeedTarget || '再选线路'}`);
                            return;
                        }
                    }
                    // 上面已同步过，这里不再覆盖，保留手动赋值的 routeRules（老链接/测试兼容）。
                }
                this.loading = true;
                this.shortenedLinks = null;
                try {
                    const origin = window.location.origin;
                    const params = new URLSearchParams();
                    params.append('config', this.input);
                    const rulesText = this.effectiveRulesText();
                    if (rulesText !== '') {
                        params.append('rules', rulesText);
                    }
                    const queryString = params.toString();
                    this.generatedLinks = {
                        xray: origin + '/xray?' + queryString,
                        singbox: origin + '/singbox?' + queryString,
                        clash: origin + '/clash?' + queryString,
                        surge: origin + '/surge?' + queryString
                    };
                    setTimeout(() => {
                        const resultsDiv = document.querySelector('.mt-12');
                        if (resultsDiv) {
                            resultsDiv.scrollIntoView({ behavior: 'smooth' });
                        }
                    }, 100);
                } catch (error) {
                    console.error('Error generating links:', error);
                    alert(window.APP_TRANSLATIONS.errorGeneratingLinks);
                } finally {
                    this.loading = false;
                }
            },

            async shortenLinks() {
                if (this.shortenedLinks) {
                    alert(window.APP_TRANSLATIONS.alreadyShortened);
                    return;
                }
                if (!this.generatedLinks) {
                    return;
                }
                this.shortening = true;
                try {
                    const origin = window.location.origin;
                    const prefixMap = { xray: 'x', singbox: 'b', clash: 'c', surge: 's' };
                    let apiUrl = `${origin}/shorten-v2?url=${encodeURIComponent(this.generatedLinks.singbox)}`;
                    const customCode = this.customShortCode.trim();
                    if (customCode) {
                        apiUrl += `&shortCode=${encodeURIComponent(customCode)}`;
                    }
                    const response = await fetch(apiUrl);
                    if (!response.ok) {
                        const detail = (await response.text()).slice(0, 200).trim();
                        throw new Error(`${response.status}${detail ? ` ${detail}` : ''}`);
                    }
                    const shortCode = (await response.text()).trim();
                    this.shortenedLinks = Object.fromEntries(
                        Object.entries(prefixMap).map(([type, prefix]) => [type, `${origin}/${prefix}/${shortCode}`])
                    );
                } catch (error) {
                    console.error('Error shortening links:', error);
                    const prefix = window.APP_TRANSLATIONS?.shortenFailed || 'Failed to shorten links';
                    alert(`${prefix}: ${error.message}`);
                } finally {
                    this.shortening = false;
                }
            },

            handleInputChange(val) {
                if (this.parseDebounceTimer) {
                    clearTimeout(this.parseDebounceTimer);
                }
                if (!val || !val.trim()) {
                    return;
                }
                this.parseDebounceTimer = setTimeout(() => {
                    this.tryParseSubscriptionUrl(val.trim());
                }, 500);
            },

            isSubscriptionUrl(text) {
                if (text.includes('\n')) {
                    return false;
                }
                try {
                    const url = new URL(text);
                    const pathMatch = url.pathname.match(/^\/([bcxs])\/([a-zA-Z0-9_-]+)$/);
                    if (pathMatch) {
                        return true;
                    }
                    const fullMatch = url.pathname.match(/^\/(singbox|clash|xray|surge)$/);
                    if (fullMatch && url.search) {
                        return true;
                    }
                    return false;
                } catch {
                    return false;
                }
            },

            async tryParseSubscriptionUrl(text) {
                if (!this.isSubscriptionUrl(text)) {
                    return;
                }
                this.parsingUrl = true;
                try {
                    let urlToParse;
                    try {
                        urlToParse = new URL(text);
                    } catch {
                        return;
                    }
                    const shortMatch = urlToParse.pathname.match(/^\/([bcxs])\/([a-zA-Z0-9_-]+)$/);
                    if (shortMatch) {
                        const response = await fetch(`/resolve?url=${encodeURIComponent(text)}`);
                        if (!response.ok) {
                            console.warn('Failed to resolve short URL');
                            return;
                        }
                        const data = await response.json();
                        if (!data.originalUrl) {
                            console.warn('No original URL returned');
                            return;
                        }
                        urlToParse = new URL(data.originalUrl);
                    }
                    this.populateFormFromUrl(urlToParse);
                    const message = window.APP_TRANSLATIONS?.urlParsedSuccess || '已成功解析订阅链接配置';
                    console.log(message);
                } catch (error) {
                    console.error('Error parsing subscription URL:', error);
                } finally {
                    this.parsingUrl = false;
                }
            },

            populateFormFromUrl(url) {
                const params = new URLSearchParams(url.search);
                const config = params.get('config');
                if (config) {
                    this.input = config;
                }
                const rules = params.get('rules');
                if (rules !== null) {
                    this.routeRules = rules;
                    localStorage.setItem('routeRulesTextarea', rules);
                    if (!rules.trim()) {
                        this.routeCards = [{ id: this.routeCardsNextId++, domains: '', preset: '', customTarget: '' }];
                        this.expertMode = false;
                    } else {
                        const cards = this.parseTextToCards(rules);
                        if (cards.length) {
                            this.routeCards = cards;
                            this.expertMode = false;
                            this.expertText = '';
                            this.syncRulesFromCards(true);
                        } else {
                            this.expertMode = true;
                            this.expertText = rules;
                        }
                    }
                }
            }
        };
    }
};
