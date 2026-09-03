// Minimal, dependency-free i18n primitive for the design SDK.
//
// Mirrors the shape of thebird's `docs/i18n.js` (catalog registry +
// setLocale/getLocale + t(key, fallbackText, vars) interpolation) so a
// consumer app that already has its own i18n runtime (thebird, freddie, ...)
// can either use this directly or wire an equivalent adapter, and so
// design's own components CAN be made translatable without design owning a
// specific consumer's catalog.
//
// Scope of this pass: the primitive exists and is exported, plus a couple of
// representative hardcoded strings in one or two components are migrated as
// proof (see src/components/chat.js). This is NOT an exhaustive sweep of
// every hardcoded string in the SDK — that is a much larger, incremental
// effort threaded through call sites over time, the same way thebird's own
// t() adoption is incremental app-by-app.
const STORAGE_KEY = 'ds-locale';
const FALLBACK_LOCALE = 'en';

const catalogs = new Map();

export function registerLocale(locale, table) {
  catalogs.set(locale, { ...(catalogs.get(locale) || {}), ...table });
}

registerLocale('en', {});

export function getLocale() {
  try {
    const stored = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    if (stored && catalogs.has(stored)) return stored;
  } catch { /* swallow: localStorage unavailable, fall through to navigator.language detection */ }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const short = navigator.language.slice(0, 2);
    if (catalogs.has(short)) return short;
  }
  return FALLBACK_LOCALE;
}

export function setLocale(locale) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale); } catch { /* swallow: localStorage write failed */ }
}

// t(key, fallbackText, vars?) — looks up key in the active locale's catalog;
// falls back to fallbackText (the literal already at the call site) so
// adoption is a non-breaking wrap: t('chat.emptySub', 'Send a message to
// start the conversation') behaves exactly like the bare literal did until a
// translation is registered for that key.
export function t(key, fallbackText, vars) {
  const locale = getLocale();
  const table = catalogs.get(locale) || {};
  let str = (key in table && typeof table[key] === 'string') ? table[key] : fallbackText;
  if (typeof str !== 'string') str = String(str ?? '');
  if (vars) str = str.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  return str;
}

export function availableLocales() {
  return [...catalogs.keys()];
}
