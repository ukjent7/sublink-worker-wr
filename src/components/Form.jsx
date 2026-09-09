/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { TextareaWithActions } from './TextareaWithActions.jsx';
import { formLogicFn } from './formLogic.js';

const LINK_FIELDS = [
  { key: 'xray', labelKey: 'xrayLink' },
  { key: 'singbox', labelKey: 'singboxLink' },
  { key: 'clash', labelKey: 'clashLink' },
  { key: 'surge', labelKey: 'surgeLink' }
];

export const Form = (props) => {
  const { t, lang } = props;

  const translations = {
    processing: t('processing'),
    convert: t('convert'),
    confirmClearAll: t('confirmClearAll'),
    errorGeneratingLinks: t('errorGeneratingLinks'),
    shortenLinks: t('shortenLinks'),
    shortening: t('shortening'),
    alreadyShortened: t('alreadyShortened'),
    shortenFailed: t('shortenFailed'),
    customShortCode: t('customShortCode'),
    optional: t('optional'),
    customShortCodePlaceholder: t('customShortCodePlaceholder'),
    showFullLinks: t('showFullLinks'),
    customRoutesStep1: t('customRoutesStep1'),
    customRoutesStep1Hint: t('customRoutesStep1Hint'),
    customRoutesStep2: t('customRoutesStep2'),
    customRoutesNeedSites: t('customRoutesNeedSites'),
    customRoutesNeedTarget: t('customRoutesNeedTarget'),
    customRoutesBadSite: t('customRoutesBadSite'),
    customRoutesOk: t('customRoutesOk'),
    customRoutesEmpty: t('customRoutesEmpty')
  };

  const scriptContent = `
    window.APP_TRANSLATIONS = ${JSON.stringify(translations)};
    window.APP_LANG = ${JSON.stringify(lang || 'zh-CN')};
    if (typeof __name === 'undefined') { var __name = function(fn) { return fn; }; }
    (${formLogicFn.toString()})();
  `;

  return (
    <div x-data="formData()" x-init="init()" class="max-w-4xl mx-auto">
      <form {...{'x-on:submit.prevent': 'submitForm'}} class="space-y-8">

      {/* Input Section */}
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-all duration-300 hover:shadow-md group">
        <TextareaWithActions
          id="input"
          name="input"
          label={t('shareUrls')}
          labelPrefix={
            <span class="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center">
              <i class="fas fa-link text-sm"></i>
            </span>
          }
          model="input"
          rows={5}
          placeholder={t('urlPlaceholder')}
          required
          labelActionsWrapperClass="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          labelActions={[
            {
              key: 'paste',
              icon: 'fas fa-paste',
              label: t('paste'),
              hideLabelOnMobile: true,
              className:
                'px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-1',
              title: t('paste'),
              attrs: {
                'x-on:click': "navigator.clipboard.readText().then(text => input = text).catch(() => {})"
              }
            },
            {
              key: 'clear',
              icon: 'fas fa-times',
              label: t('clear'),
              hideLabelOnMobile: true,
              className:
                'px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center gap-1',
              title: t('clear'),
              attrs: {
                'x-on:click': "input = ''",
                'x-show': 'input'
              }
            }
          ]}
        />
      </div>

      {/* Custom Routing Section: toddler-simple cards */}
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:shadow-md p-6 space-y-4">
        <div class="flex items-center gap-3">
          <span class="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center">
            <i class="fas fa-route text-sm"></i>
          </span>
          <div>
            <div class="text-lg font-semibold text-gray-900 dark:text-white">{t('customRoutes')}</div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{t('customRoutesHelp')}</p>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button type="button" x-on:click="useTemplateDmm()" class="px-3 py-1.5 text-xs font-medium rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors">
            {t('customRoutesTplDmm')}
          </button>
          <button type="button" x-on:click="useTemplateMedia()" class="px-3 py-1.5 text-xs font-medium rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors">
            {t('customRoutesTplMedia')}
          </button>
        </div>

        {/* Simple cards */}
        <div x-show="!expertMode" class="space-y-3">
          <template x-for="(card, idx) in routeCards" x-bind:key="card.id">
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-700 dark:text-gray-200" x-text="'#' + (idx + 1)"></span>
                <button type="button" x-on:click="removeRouteCard(idx)" class="text-xs text-gray-400 hover:text-red-500 transition-colors">
                  <i class="fas fa-trash-alt"></i> {t('customRoutesDelete')}
                </button>
              </div>
              <div class="grid md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('customRoutesStep1')}</label>
                  <textarea rows="3" x-model="routeCards[idx].domains" x-on:input="onCardInput()" placeholder={t('customRoutesDomainsPlaceholder')} class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y placeholder-gray-400"></textarea>
                  <p class="text-[11px] text-gray-400 mt-1">{t('customRoutesStep1Hint')}</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('customRoutesStep2')}</label>
                  <div class="flex flex-wrap gap-1.5">
                    <button type="button" x-on:click="setCardPreset(idx, '日本')" x-bind:class="routeCards[idx].preset === '日本' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetJapan')}</button>
                    <button type="button" x-on:click="setCardPreset(idx, '美国')" x-bind:class="routeCards[idx].preset === '美国' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetUsa')}</button>
                    <button type="button" x-on:click="setCardPreset(idx, '香港')" x-bind:class="routeCards[idx].preset === '香港' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetHk')}</button>
                    <button type="button" x-on:click="setCardPreset(idx, '新加坡')" x-bind:class="routeCards[idx].preset === '新加坡' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetSg')}</button>
                    <button type="button" x-on:click="setCardPreset(idx, '__direct')" x-bind:class="routeCards[idx].preset === '__direct' ? 'bg-green-600 text-white border-green-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetDirect')}</button>
                    <button type="button" x-on:click="setCardPreset(idx, '__block')" x-bind:class="routeCards[idx].preset === '__block' ? 'bg-red-600 text-white border-red-600' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetBlock')}</button>
                    <button type="button" x-on:click="setCardPreset(idx, '__custom')" x-bind:class="routeCards[idx].preset === '__custom' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'" class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors">{t('customRoutesPresetCustom')}</button>
                  </div>
                  <div x-show="routeCards[idx].preset === '__custom'" class="mt-2">
                    <input type="text" x-model="routeCards[idx].customTarget" x-on:input="onCardInput()" placeholder={t('customRoutesTargetPlaceholder')} class="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                  </div>
                </div>
              </div>
              <div class="flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5" x-bind:class="cardStatus(routeCards[idx]).ok ? (cardStatus(routeCards[idx]).warn ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300' : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-300') : 'bg-gray-100 dark:bg-gray-800 text-gray-400'">
                <span x-text="cardStatus(routeCards[idx]).text || '…'">…</span>
                <code x-show="cardPreview(routeCards[idx])" x-text="cardPreview(routeCards[idx])" class="font-mono truncate max-w-[60%] opacity-70"></code>
              </div>
            </div>
          </template>
          <button type="button" x-on:click="addRouteCard()" class="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600 transition-colors">
            {t('customRoutesAdd')}
          </button>
          <p class="text-[11px] text-gray-400 font-mono break-all">
            <span>{t('customRoutesPreview')}</span><span x-text="routeRules || '（空）'"></span>
          </p>
        </div>

        {/* Expert toggle */}
        <div>
          <button type="button" x-on:click="expertMode = !expertMode" class="text-xs text-gray-400 hover:text-primary-500 transition-colors">
            <span x-show="!expertMode">{t('customRoutesExpert')}</span>
            <span x-show="expertMode">{t('customRoutesBackToSimple')}</span>
          </button>
          <div x-show="expertMode" class="mt-2">
            <p class="text-[11px] text-gray-400 mb-1">{t('customRoutesExpertHint')}</p>
            <textarea rows="5" x-model="expertText" placeholder={t('customRoutesPlaceholder')} class="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 font-mono text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y placeholder-gray-400"></textarea>
          </div>
        </div>
      </div>

  {/* Action Buttons */ }
  <div class="flex flex-col sm:flex-row gap-4">
          <button 
            type="submit" 
            class="flex-1 py-3.5 px-6 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white rounded-xl font-bold shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40 transform hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2"
            x-bind:disabled="loading"
          >
            <i class="fas fa-sync-alt" x-bind:class="loading ? 'fa-spinner fa-spin' : 'fa-sync-alt'"></i>
            <span x-text="loading ? processingText : convertText">{t('convert')}</span>
          </button>

  <button
    type="button" 
            x-on:click="clearAll()"
class="px-6 py-3.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
  >
  <i class="fas fa-trash-alt"></i>
{ t('clear') }
          </button>
        </div>
      </form>

  {/* Results Section */ }
  <div x-cloak x-show="generatedLinks" x-data="{ copied: null }" {...{'x-transition:enter': 'transition ease-out duration-500', 'x-transition:enter-start': 'opacity-0 transform translate-y-8', 'x-transition:enter-end': 'opacity-100 transform translate-y-0'}} class="mt-12">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8 transition-all duration-300 hover:shadow-md">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <span class="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center">
            <i class="fas fa-link text-sm"></i>
          </span>
          {t('subscriptionLinks')}
        </h2>
      </div>

      <div class="mt-6 space-y-4">
        {LINK_FIELDS.map((field) => (
          <div class="relative group" key={field.key}>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t(field.labelKey)}
            </label>
            <div class="flex gap-2">
              <input
                type="text"
                readonly
                x-bind:value={`shortenedLinks ? shortenedLinks?.${field.key} : generatedLinks?.${field.key}`}
                class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:border-transparent transition-all duration-200 font-mono text-sm"
                x-bind:class="shortenedLinks ? 'text-primary-600 dark:text-primary-400 font-semibold focus:ring-primary-500' : 'text-gray-600 dark:text-gray-400 focus:ring-green-500'"
              />
              <button
                type="button"
                x-on:click={`navigator.clipboard.writeText((shortenedLinks || generatedLinks)?.${field.key}); copied = '${field.key}'; setTimeout(() => copied = null, 2000)`}
                class="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
                x-bind:class={`{
                  'hover:bg-green-100 dark:hover:bg-green-900/30 hover:text-green-600 dark:hover:text-green-400': !shortenedLinks,
                  'hover:bg-primary-100 dark:hover:bg-primary-900/30 hover:text-primary-600 dark:hover:text-primary-400': shortenedLinks,
                  'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400': !shortenedLinks && copied === '${field.key}',
                  'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400': shortenedLinks && copied === '${field.key}'
                }`}
              >
                <i class="fas" x-bind:class={`copied === '${field.key}' ? 'fa-check' : 'fa-copy'`}></i>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Shortening Controls */}
      <div class="mt-6">
        <div class="flex flex-col items-center gap-3">
          <div class="w-full max-w-md">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 text-center">
              {t('customShortCode')} <span class="text-gray-400">({t('optional')})</span>
            </label>
            <input
              type="text"
              x-model="customShortCode"
              placeholder={t('customShortCodePlaceholder')}
              class="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 text-center"
            />
          </div>
        </div>
        <div class="flex justify-center mt-4">
          <button
            type="button"
            x-on:click="shortenedLinks ? shortenedLinks = null : shortenLinks()"
            x-bind:disabled="!shortenedLinks && shortening"
            class="px-6 py-3 rounded-xl font-semibold transition-all duration-200 flex items-center gap-2 shadow-lg"
            x-bind:class="shortenedLinks
              ? 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm'
              : 'bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-700 hover:to-primary-600 text-white shadow-primary-500/30 hover:shadow-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed'"
          >
            <i
              class="fas"
              x-bind:class="shortenedLinks ? 'fa-expand-alt' : (shortening ? 'fa-spinner fa-spin' : 'fa-compress-alt')"
            ></i>
            <span
              x-text="shortenedLinks ? showFullLinksText : (shortening ? shorteningText : shortenLinksText)"
            ></span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <script dangerouslySetInnerHTML={{ __html: scriptContent }} />
    </div>
  );
};
