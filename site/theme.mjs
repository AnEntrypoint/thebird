// AnEntrypoint design-system theme for flatspace — thin delegate over the
// SDK's vendored renderPageHtml (docs/vendor/page-html.js, refreshed by
// scripts/refresh-design.mjs same as every other SDK surface thebird
// consumes). Landing page scaffolding (hero, panels, receipt-style rows,
// SEO meta) all comes from the SDK; this file only maps site/content YAML
// into renderPageHtml's data shape.
//
// app.html (the live web-OS shell) is NOT a renderPageHtml page — it boots
// createOSShell() directly and owns its own <head> (importmap, per-instance
// SW registration, vendored CSS links), so it stays a bespoke template here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeHtml } from '../docs/vendor/html-escape.js';
import { renderPageHtml } from '../docs/vendor/page-html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appShellCss = readFileSync(join(__dirname, 'app-shell.css'), 'utf8');

function rowsFromKv(rows) {
  return (rows || []).map((r, i) => ({ code: String(i + 1).padStart(2, '0'), title: r.k, sub: r.v, meta: '' }));
}

const renderAppHtml = ({ site, page }) => `<!DOCTYPE html>
<html lang="en" class="ds-247420">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(page.title || site.title)}${site.tagline ? ' — ' + escapeHtml(site.tagline) : ''}</title>
  <meta name="description" content="${escapeHtml(page.description || site.description || site.tagline || site.title)}" />
  <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
  <link rel="stylesheet" href="https://raw.githack.com/AnEntrypoint/design/main/dist/247420.css" />
  <link rel="stylesheet" href="./vendor/kits/os/colors_and_type.css" />
  <link rel="stylesheet" href="./vendor/kits/os/app-shell.css" />
  <link rel="stylesheet" href="./vendor/kits/os/theme.css" />
  <link rel="stylesheet" href="./vendor/kits/os/freddie-dashboard.css" />
  <link rel="stylesheet" href="./vendor/xterm.css" />
  <style>html,body{margin:0;padding:0;height:100vh;height:100dvh;overflow:hidden}</style>
</head>
<body>
  <script type="module">
    import { createOSShell } from './os-shell.js';
    createOSShell({ root: document.body, autoBoot: true });
  </script>
</body>
</html>
`;

export default {
  // Copy entire docs/ tree so the live web-OS is reachable at ./.
  // The "todo app" is just the default index.html that lives in IndexedDB —
  // it's seeded by docs/defaults.json and rendered through the preview tab,
  // not as a separate top-level landing page.
  // Copy docs/ contents into the dist root so the OS owns its own URL scope
  // and the per-instance SW (./sw-iN/) plus vendored models/transformers/
  // resolve relative to the page. Living under /app/ broke SW scope and
  // any module-URL-relative fetch in vendored libraries.
  assets: {
    '../docs': '.',
    '../docs/favicon.svg': 'favicon.svg',
  },
  render: async (ctx) => {
    const site = ctx.readGlobal('site') || {};
    const nav = ctx.readGlobal('navigation') || { links: [] };
    const docs = ctx.read('pages').docs;
    const homeDoc = docs.find(p => p.id === 'home');
    if (!homeDoc) throw new Error('site/content/pages/home.yaml missing or has no id: home');

    const osPage = { title: 'os', description: 'thebird web os — windowed shell, agentic chat, browser, terminal, IDB filesystem.' };

    const panels = [];
    if (homeDoc.features && homeDoc.features.items && homeDoc.features.items.length) {
      panels.push({
        title: homeDoc.features.heading || 'features',
        count: homeDoc.features.items.length,
        items: homeDoc.features.items.map((it, i) => ({
          code: it.code || String(i + 1).padStart(2, '0'), title: it.name, sub: it.desc || '', meta: it.meta || '->', href: it.href || '#',
        })),
      });
    }
    if (homeDoc.receipt && homeDoc.receipt.rows && homeDoc.receipt.rows.length) {
      panels.push({ title: homeDoc.receipt.heading || 'receipt', items: rowsFromKv(homeDoc.receipt.rows) });
    }

    const sections = [];
    if (homeDoc.architecture && homeDoc.architecture.body) {
      sections.push({
        id: 'architecture',
        name: homeDoc.architecture.panel_title || homeDoc.architecture.heading || 'architecture',
        body: '```\n' + homeDoc.architecture.body + '\n```',
      });
    }

    const landingHtml = renderPageHtml({
      title: homeDoc.title || site.title,
      slug: 'index',
      siteName: site.title || '247420',
      navItems: (nav.links || []).map(l => [String(l.label || ''), l.href]),
      hero: homeDoc.hero ? {
        heading: homeDoc.hero.heading, subheading: homeDoc.hero.subheading,
        body: homeDoc.hero.body, ctas: homeDoc.hero.ctas,
      } : null,
      panels,
      sections,
      quickstart: homeDoc.quickstart && homeDoc.quickstart.rows
        ? { heading: homeDoc.quickstart.heading, lines: homeDoc.quickstart.rows.map(r => ({ text: `${r.k}: ${r.v}` })) }
        : null,
      statusRight: site.repo ? [`247420 / mmxxvi`, `source -> ${site.repo}`] : ['247420 / mmxxvi'],
      seo: {
        description: homeDoc.description || site.description || site.tagline || site.title,
        url: site.url || '',
      },
      faviconHref: './favicon.svg',
      headExtra: `<style>${appShellCss}</style>`,
    });

    return [
      // Root index.html is shipped by the docs/ copy directly (it owns the
      // importmap, theme.js wiring, brand-css link, and per-instance SW
      // registration). The flatspace-rendered landing page below is the
      // marketing/bookmark alias, not the OS entrypoint.
      { path: 'landing.html', html: landingHtml },
      { path: 'app.html', html: renderAppHtml({ site, page: osPage }) },
    ];
  }
};
