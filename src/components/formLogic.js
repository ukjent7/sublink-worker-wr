export const formLogicFn = (t) => {
    window.formData = function () {
        return {
            input: '',
            loading: false,
            generatedLinks: null,
            shortenedLinks: null,
            shortening: false,
            customShortCode: '',
            parsingUrl: false,
            parseDebounceTimer: null,
            // These will be populated from window.APP_TRANSLATIONS
            processingText: '',
            convertText: '',
            shortenLinksText: '',
            shorteningText: '',
            showFullLinksText: '',

            init() {
                // Load translations
                if (window.APP_TRANSLATIONS) {
                    this.processingText = window.APP_TRANSLATIONS.processing;
                    this.convertText = window.APP_TRANSLATIONS.convert;
                    this.shortenLinksText = window.APP_TRANSLATIONS.shortenLinks;
                    this.shorteningText = window.APP_TRANSLATIONS.shortening;
                    this.showFullLinksText = window.APP_TRANSLATIONS.showFullLinks;
                }

                // Load saved data
                this.input = localStorage.getItem('inputTextarea') || '';
                this.customShortCode = localStorage.getItem('customShortCode') || '';

                // Watchers to save state
                this.$watch('input', val => {
                    localStorage.setItem('inputTextarea', val);
                    this.handleInputChange(val);
                });
                this.$watch('customShortCode', val => localStorage.setItem('customShortCode', val));
            },

            clearAll() {
                if (confirm(window.APP_TRANSLATIONS.confirmClearAll)) {
                    this.input = '';
                    this.generatedLinks = null;
                    this.shortenedLinks = null;
                    this.customShortCode = '';
                    // Also clear from localStorage
                    localStorage.removeItem('customShortCode');
                }
            },

            async submitForm() {
                this.loading = true;
                this.shortenedLinks = null; // Reset shortened links when generating new links
                try {
                    // Construct URLs
                    const origin = window.location.origin;
                    const params = new URLSearchParams();
                    params.append('config', this.input);

                    const queryString = params.toString();

                    this.generatedLinks = {
                        xray: origin + '/xray?' + queryString,
                        singbox: origin + '/singbox?' + queryString,
                        clash: origin + '/clash?' + queryString,
                        surge: origin + '/surge?' + queryString
                    };

                    // Scroll to results
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
                // Check if links are already shortened
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
                    const shortened = {};

                    // Use custom short code if provided, otherwise let backend generate it once
                    let shortCode = this.customShortCode.trim();
                    let isFirstRequest = true;

                    // Shorten each link type
                    for (const [type, url] of Object.entries(this.generatedLinks)) {
                        try {
                            let apiUrl = `${origin}/shorten-v2?url=${encodeURIComponent(url)}`;

                            // For the first request, either use custom code or let backend generate
                            // For subsequent requests, use the code from first request
                            if (shortCode) {
                                apiUrl += `&shortCode=${encodeURIComponent(shortCode)}`;
                            }

                            const response = await fetch(apiUrl);
                            if (!response.ok) {
                                throw new Error(`Failed to shorten ${type} link`);
                            }
                            const returnedCode = await response.text();

                            // If this is the first request and no custom code was provided,
                            // use the backend-generated code for all subsequent requests
                            if (isFirstRequest && !shortCode) {
                                shortCode = returnedCode;
                            }
                            isFirstRequest = false;

                            // Map types to their corresponding path prefixes
                            const prefixMap = {
                                xray: 'x',
                                singbox: 'b',
                                clash: 'c',
                                surge: 's'
                            };

                            shortened[type] = `${origin}/${prefixMap[type]}/${returnedCode}`;
                        } catch (error) {
                            console.error(`Error shortening ${type} link:`, error);
                            throw error;
                        }
                    }

                    this.shortenedLinks = shortened;
                } catch (error) {
                    console.error('Error shortening links:', error);
                    alert(window.APP_TRANSLATIONS.shortenFailed);
                } finally {
                    this.shortening = false;
                }
            },

            // Handle input change with debounce
            handleInputChange(val) {
                // Clear previous timer
                if (this.parseDebounceTimer) {
                    clearTimeout(this.parseDebounceTimer);
                }

                // If input is empty, don't try to parse
                if (!val || !val.trim()) {
                    return;
                }

                // Debounce for 500ms
                this.parseDebounceTimer = setTimeout(() => {
                    this.tryParseSubscriptionUrl(val.trim());
                }, 500);
            },

            // Check if input looks like a subscription URL
            isSubscriptionUrl(text) {
                // Check if it's a single line URL (not multiple lines)
                if (text.includes('\n')) {
                    return false;
                }

                try {
                    const url = new URL(text);
                    // Check if it matches our short link pattern: /[bcxs]/[code]
                    const pathMatch = url.pathname.match(/^\/([bcxs])\/([a-zA-Z0-9_-]+)$/);
                    if (pathMatch) {
                        return true;
                    }

                    // Check if it's a full subscription URL with query params
                    const fullMatch = url.pathname.match(/^\/(singbox|clash|xray|surge)$/);
                    if (fullMatch && url.search) {
                        return true;
                    }

                    return false;
                } catch {
                    return false;
                }
            },

            // Try to parse subscription URL
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

                    // Check if it's a short link
                    const shortMatch = urlToParse.pathname.match(/^\/([bcxs])\/([a-zA-Z0-9_-]+)$/);

                    if (shortMatch) {
                        // It's a short link, resolve it first
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

                    // Now parse the full URL and populate form
                    this.populateFormFromUrl(urlToParse);

                    // Show a success message
                    const message = window.APP_TRANSLATIONS?.urlParsedSuccess || '已成功解析订阅链接配置';
                    console.log(message);

                } catch (error) {
                    console.error('Error parsing subscription URL:', error);
                } finally {
                    this.parsingUrl = false;
                }
            },

            // Populate form fields from parsed URL
            populateFormFromUrl(url) {
                const params = new URLSearchParams(url.search);

                // Extract config (the original subscription URLs)
                const config = params.get('config');
                if (config) {
                    this.input = config;
                }
            }
        }
    }
};
