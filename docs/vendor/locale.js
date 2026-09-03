// 247420 design system — date/time/number formatting helpers.
//
// Consumes i18n.js's getLocale() as the single source of truth for "what
// locale is active" (its own ds-locale storage key + navigator.language
// detection) rather than maintaining a second, independent locale setting --
// two different "current locale" sources in the same package would silently
// disagree with each other. i18n.js's getLocale() returns a short code
// ('en'); Intl APIs accept a short code fine (BCP-47 allows bare language
// subtags), so no expansion to a full region tag ('en-US') is needed or
// assumed here -- if a consumer wants region-specific formatting (e.g. the
// exact '1,234.56' vs '1.234,56' split within an 'en' vs 'en-GB' distinction)
// they pass an explicit locale argument, same as every function below
// already supports.
import { getLocale } from './i18n.js';

function hour12Preference(locale) {
    try { return Intl.DateTimeFormat(locale).resolvedOptions().hour12; }
    catch { return undefined; }
}

// formatTime: replaces bare `new Date().toLocaleTimeString()` -- explicit
// locale (never the implicit-undefined default) plus the locale's own
// resolved hour12 preference (never hardcoded 12/24h).
export function formatTime(date, locale = getLocale()) {
    const hour12 = hour12Preference(locale);
    try { return new Date(date).toLocaleTimeString(locale, hour12 === undefined ? undefined : { hour12 }); }
    catch { return new Date(date).toLocaleTimeString(); }
}

export function formatDateTime(date, locale = getLocale()) {
    const hour12 = hour12Preference(locale);
    try { return new Date(date).toLocaleString(locale, hour12 === undefined ? undefined : { hour12 }); }
    catch { return new Date(date).toLocaleString(); }
}

// formatNumber: replaces bare `n.toLocaleString()` -- explicit locale for
// thousands-separator/decimal conventions that genuinely differ (e.g.
// '1,234.5' en vs '1.234,5' de).
export function formatNumber(n, locale = getLocale()) {
    try { return n.toLocaleString(locale); } catch { return String(n); }
}

const RTF_DIVISIONS = [
    { amount: 60, unit: 'seconds' },
    { amount: 60, unit: 'minutes' },
    { amount: 24, unit: 'hours' },
    { amount: 7, unit: 'days' },
    { amount: 4.34524, unit: 'weeks' },
    { amount: 12, unit: 'months' },
    { amount: Infinity, unit: 'years' },
];

// formatRelativeTime: "2 hours ago" via the real Intl.RelativeTimeFormat,
// never a hand-rolled string-concat implementation.
export function formatRelativeTime(date, locale = getLocale(), now = Date.now()) {
    let duration = (new Date(date).getTime() - now) / 1000;
    try {
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        for (const division of RTF_DIVISIONS) {
            if (Math.abs(duration) < division.amount) return rtf.format(Math.round(duration), division.unit);
            duration /= division.amount;
        }
    } catch { /* swallow: Intl.RelativeTimeFormat unsupported/threw, fall through to the plain-time fallback below */ }
    return formatTime(date, locale);
}
