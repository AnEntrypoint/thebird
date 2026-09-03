// Document <head> fragments for the static-site renderer: the full
// SEO/OG/twitter/schema.org meta block, the favicon link (static href or an
// inline data: SVG from a single glyph), and the stylesheet link.

import { escape } from './markdown.js';

// Full SEO/OG/twitter/schema.org meta block, extracted so renderPageHtml
// consumers (design's own marketing site, thebird's landing) can opt in
// instead of hand-rolling ~40 lines of <meta> tags per theme.mjs.
export function renderSeoTags({ title, siteName, seo }) {
    const desc = escape(seo.description || '');
    const url = escape(seo.url || '');
    const image = escape(seo.image || '');
    const author = escape(seo.author || siteName);
    const twitter = escape(seo.twitter || '');
    const locale = escape(seo.locale || 'en_US');
    const keywords = escape(Array.isArray(seo.keywords) ? seo.keywords.join(', ') : (seo.keywords || ''));
    const ogTitle = escape(title);
    const ogDesc = escape(seo.description || siteName);
    let out = `
<meta name="description" content="${desc}">
${keywords ? `<meta name="keywords" content="${keywords}">` : ''}
<meta name="author" content="${author}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="generator" content="anentrypoint-design">
${url ? `<link rel="canonical" href="${url}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
${url ? `<meta property="og:url" content="${url}">` : ''}
<meta property="og:site_name" content="${escape(siteName)}">
<meta property="og:locale" content="${locale}">
${image ? `<meta property="og:image" content="${image}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ogTitle}">
<meta name="twitter:description" content="${ogDesc}">
${twitter ? `<meta name="twitter:site" content="${twitter}">` : ''}
${image ? `<meta name="twitter:image" content="${image}">` : ''}`;
    if (seo.ldJson !== false && (seo.description || url)) {
        const ld = JSON.stringify({
            '@context': 'https://schema.org', '@type': 'WebSite',
            name: title, url: seo.url || '', description: seo.description || '', inLanguage: seo.lang || 'en',
        }).replace(/</g, '\\u003c');
        out += `\n<script type="application/ld+json">${ld}</script>`;
    }
    return out;
}

export function renderFaviconTags({ faviconHref, faviconGlyph }) {
    if (faviconHref) return `<link rel="icon" href="${escape(faviconHref)}">`;
    if (faviconGlyph) return `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E${encodeURIComponent(faviconGlyph)}%3C/text%3E%3C/svg%3E">`;
    return '';
}

export function renderCssLink({ cssHref, pkgVersion }) {
    return cssHref
        ? `<link rel="stylesheet" href="${cssHref}">`
        : `<link rel="stylesheet" href="https://unpkg.com/anentrypoint-design@${pkgVersion}/dist/247420.css">`;
}
