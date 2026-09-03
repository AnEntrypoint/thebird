// The client-side mount script the SSR document embeds, as a string. It is
// NOT module code in this file's own scope: it ships verbatim inside the
// emitted <script type="module"> and runs in the browser against the SDK's
// `mount`/`components`/`h` exports plus the `__site__` JSON payload.
//
// It stays a template literal (not a real module compiled and inlined) because
// it must reach the browser as source with its own escaping intact — every
// backslash/backtick sequence below is written for the emitted output, not for
// this file. `clientScriptExtra` is appended raw after the mount() call.

export const CLIENT_SCRIPT = `import { mount, components as C, h } from 'anentrypoint-design';
let data;
try {
  data = JSON.parse(document.getElementById('__site__').textContent);
} catch (e) {
  console.error('[page-html] failed to parse #__site__ bootstrap data:', e);
  document.getElementById('app').textContent = 'This page failed to load correctly. Please refresh, or contact support if the problem persists.';
  throw e;
}

function heroNode(hero) {
  if (!hero) return null;
  const badges = Array.isArray(hero.badges) ? hero.badges.filter(Boolean) : [];
  const badgeRow = badges.length
    ? h('div', { class: 'ds-hero-stats' }, ...badges.map((b, i) =>
        h('span', { key: i, class: 'ds-hero-stat' },
          h('strong', { class: 'ds-hero-stat-n' }, String(b.label != null ? b.label : b)),
          b.desc ? h('span', { class: 'ds-hero-stat-l' }, String(b.desc)) : null,
        )))
    : null;
  return h('div', { class: 'ds-hero' },
    hero.eyebrow ? h('span', { class: 'eyebrow' }, hero.eyebrow) : null,
    h('h1', { class: 'ds-hero-title' }, hero.heading || hero.title || data.title),
    (hero.body || hero.subheading) ? h('p', { class: 'ds-hero-body' },
      hero.body || hero.subheading,
      hero.accent ? h('span', { class: 'ds-hero-accent' }, ' ' + hero.accent) : null,
    ) : null,
    // Every hero CTA is a plain <a href> that navigates away from this page
    // (GitHub, the portfolio site, ...), never an in-page action -- so the
    // trailing arrow is appended here once, at the render layer, rather than
    // hand-typed per label in content yaml where it could drift out of sync
    // with the "navigates away = arrow" rule used elsewhere (row ctas,
    // signin's in-page submit buttons).
    Array.isArray(hero.ctas) && hero.ctas.length
      ? h('div', { class: 'ds-hero-actions' }, ...hero.ctas.map((c, i) =>
          h('a', { key: i, class: i === 0 ? 'btn btn-accent' : 'btn btn-ghost', href: c.href || '#' }, (c.label || c.cta || 'go') + ' ->')))
      : null,
    badgeRow,
  );
}

function __esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// A live, interactive strip of the actual SDK components (not a screenshot,
// not a description) rendered directly below the hero -- "show, don't just
// tell" concretely: real Btn/Chip/Badge/Table specimens, mounted from the
// same C.* namespace every kit page uses, so what a visitor sees IS what a
// consumer gets by importing the SDK.
function showcaseNode(showcase) {
  if (!showcase) return null;
  const btnRow = h('div', { class: 'ds-showcase-row' },
    C.Btn({ key: 'b1', variant: 'primary', children: 'Primary' }),
    C.Btn({ key: 'b2', variant: 'default', children: 'Default' }),
    C.Btn({ key: 'b3', variant: 'ghost', children: 'Ghost' }),
    // .ds-showcase-btn-danger-group gives Danger its own visually separated
    // cluster (extra leading gap + a hairline divider) instead of sitting in
    // the same uniform-gap row as Primary -- two similarly-weighted filled
    // buttons side by side otherwise compete for "the one action to take"
    // with nothing marking Danger as the deliberately-set-apart one.
    h('span', { key: 'b4-group', class: 'ds-showcase-btn-danger-group' },
      C.Btn({ key: 'b4', variant: 'danger', children: 'Danger' })),
  );
  // Hue documents STATUS, not decoration: green = shipping/live, blue = pre-
  // release/in-flux, purple = newly added. Badge (not a bespoke pill) carries
  // the '0 violations' count so every status indicator in this row is one of
  // the two real chip-family components, never a one-off styled span.
  const chipRow = h('div', { class: 'ds-showcase-row' },
    C.Chip({ key: 'c1', tone: 'green', children: 'Live' }),
    C.Chip({ key: 'c2', tone: 'blue', children: 'Beta' }),
    C.Chip({ key: 'c3', tone: 'purple', children: 'New' }),
    C.Badge({ key: 'c4', tone: 'success', children: '0 violations' }),
  );
  const table = C.Table({
    headers: ['Kit', 'Status', 'A11y'],
    rows: [
      ['chat', 'shipped', 'pass'],
      ['dashboard', 'shipped', 'pass'],
      ['os', 'shipped', 'pass'],
    ],
    compact: true,
  });
  return C.Section({
    id: 'showcase',
    title: showcase.heading || 'Live components',
    children: [
      showcase.lede ? h('p', { class: 'ds-lede' }, showcase.lede) : null,
      h('div', { class: 'ds-showcase-grid' },
        h('div', { key: 'btns', class: 'ds-showcase-card' },
          h('span', { class: 'ds-showcase-label' }, 'Buttons'), btnRow),
        h('div', { key: 'chips', class: 'ds-showcase-card' },
          h('span', { class: 'ds-showcase-label' }, 'Chips & badges'), chipRow),
        h('div', { key: 'table', class: 'ds-showcase-card ds-showcase-card--wide' },
          h('span', { class: 'ds-showcase-label' }, 'Table'), table),
      ),
    ].filter(Boolean),
  });
}

function sectionNode(sec, idx) {
  const features = sec.features || sec.items || [];
  const rows = features.map((f, i) => {
    const kids = [h('div', { key: 't', class: 'ds-feature-title' }, String(f.name || ''))];
    if (f.desc) kids.push(h('div', { key: 'd', class: 'ds-feature-desc', innerHTML: __esc(String(f.desc)).replace(/\`([^\`]+)\`/g, '<code>$1</code>') }));
    if (f.benefit) kids.push(h('div', { key: 'b', class: 'ds-feature-benefit' }, String(f.benefit)));
    return h('div', { key: i, class: 'ds-feature' }, ...kids);
  });
  return C.Section({
    id: sec.id || null,
    title: sec.name || sec.title || sec.id,
    children: [
      sec.lede ? h('p', { class: 'ds-lede' }, sec.lede) : null,
      ...rows,
      sec.body && String(sec.body).trim() ? h('div', { class: 'page-body', innerHTML: __md(sec.body) }) : null,
    ].filter(Boolean),
  });
}

function examplesNode(examples) {
  if (!examples || !examples.length) return null;
  return C.Section({
    title: 'explore',
    children: examples.map((e, i) => {
      const code = e.code == null ? '' : String(e.code).trim();
      const kids = [];
      if (code) kids.push(h('span', { key: 'c', class: 'code' }, code));
      kids.push(h('span', { key: 't', class: 'title' }, String(e.label || e.name || e.href || '')));
      if (e.desc) kids.push(h('span', { key: 'm', class: 'meta dim' }, ' — ' + e.desc));
      kids.push(h('span', { key: 'a', class: 'ds-row-arrow' }, '->'));
      return h('a', { key: i, class: 'row', href: e.href || '#' }, ...kids);
    }),
  });
}

// Category glyph per homepage panel id — the same line-icon vocabulary
// icons.js already provides, so kits/previews/decks/docs read as distinct
// categories at a glance instead of by text label alone. Falls back to no
// icon for panel ids outside this table (e.g. one-off feature panels).
const PANEL_ICON = {
  kits: 'grid',
  file_browser: 'folder',
  desktop_os: 'square',
  web_components: 'page',
  api_exports: 'link',
  decks: 'screen',
  docs: 'file-text',
  previews: 'eye',
  features: 'info',
};

// Filter state for the kits search box above the "ui kits" panel. Reuses
// ui_kits/search's own query-bar pattern (plain module-level state object,
// mutated on input, driving a re-render) rather than inventing a second
// filtering mechanism -- this homepage already ships that kit, so the
// homepage's own kit listing gets the same affordance instead of being the
// one surface on the site without a way to search kits by name.
const kitsFilterState = { q: '' };

function panelNode(panel, idx, rerender) {
  let items = Array.isArray(panel.items) ? panel.items : [];
  const isKits = panel.id === 'kits';
  const q = isKits ? kitsFilterState.q.trim().toLowerCase() : '';
  if (isKits && q) {
    items = items.filter((it) => {
      const hay = (String(it.title || it.name || '') + ' ' + String(it.sub || it.desc || '')).toLowerCase();
      return hay.includes(q);
    });
  }
  const iconName = panel.id && PANEL_ICON[panel.id];
  const titleText = panel.title || panel.name || '';
  const titleNode = iconName && titleText
    ? h('span', { class: 'ds-panel-title-glyph' }, C.Icon(iconName, { size: 15 }), h('span', {}, titleText))
    : titleText;
  const filterInput = isKits && rerender ? h('div', { class: 'ds-kits-filter' },
    h('input', {
      type: 'search', class: 'input ds-kits-filter-input',
      placeholder: 'filter kits by name or description…',
      value: kitsFilterState.q,
      'aria-label': 'filter ui kits',
      oninput: (e) => { kitsFilterState.q = e.target.value; rerender(); },
    })) : null;
  if (!items.length) {
    if (isKits && q) {
      return h('div', { class: 'ds-kits-panel-wrap' }, filterInput,
        C.Panel({ id: panel.id || null, title: titleNode, count: 0, children:
          h('div', { class: 'ds-empty-state' },
            h('div', { class: 'ds-empty-state-glyph' }, '( )'),
            h('p', { class: 'ds-empty-state-msg' }, 'no kits match ', h('code', {}, '"' + kitsFilterState.q.trim() + '"')),
          ) }));
    }
    return filterInput ? h('div', { class: 'ds-kits-panel-wrap' }, filterInput) : null;
  }
  // Card-grid layout (panel.layout === 'cards'): each item gets its own
  // visual tile with a code badge and a two-line title/sub stack, instead of
  // a single-line text row -- the "show, don't just tell" request for a
  // browsable gallery feel on the kits panel specifically, opt-in per panel
  // so every other panel (docs, api_exports, etc) keeps its dense row list,
  // which suits reference material better than a card grid would.
  const rows = panel.layout === 'cards'
    ? items.map((it, i) => {
        const code = it.code == null ? '' : String(it.code).trim();
        return h('a', { key: i, class: 'ds-kit-card', href: it.href || '#' },
          code ? h('span', { key: 'c', class: 'ds-kit-card-code' }, code) : null,
          h('span', { key: 't', class: 'ds-kit-card-title' }, String(it.title || it.name || '')),
          (it.sub || it.desc) ? h('span', { key: 'm', class: 'ds-kit-card-sub' }, it.sub || it.desc) : null,
          h('span', { key: 'a', class: 'ds-kit-card-arrow' }, it.meta || '->'),
        );
      })
    : items.map((it, i) => {
        const code = it.code == null ? '' : String(it.code).trim();
        const kids = [];
        if (code) kids.push(h('span', { key: 'c', class: 'code' }, code));
        kids.push(h('span', { key: 't', class: 'title' }, String(it.title || it.name || '')));
        if (it.sub || it.desc) kids.push(h('span', { key: 'm', class: 'meta dim' }, ' — ' + (it.sub || it.desc)));
        kids.push(h('span', { key: 'a', class: 'ds-row-arrow' }, it.meta || '->'));
        return h('a', { key: i, class: 'row', href: it.href || '#' }, ...kids);
      });
  const rowsWrapped = panel.layout === 'cards' ? h('div', { class: 'ds-kit-card-grid' }, ...rows) : rows;
  const panelEl = C.Panel({ id: panel.id || null, title: titleNode, count: items.length, children: rowsWrapped });
  return filterInput ? h('div', { class: 'ds-kits-panel-wrap' }, filterInput, panelEl) : panelEl;
}

function marqueeNode(marquee) {
  if (!marquee || !Array.isArray(marquee.items) || !marquee.items.length) return null;
  return C.Marquee ? C.Marquee({ items: marquee.items, sep: marquee.sep || '/' }) : null;
}

let __copyResetTimer = null;
function copyQuickstart(text, btnEl) {
  const done = (ok) => {
    if (!btnEl) return;
    btnEl.textContent = ok ? 'copied' : 'copy failed';
    clearTimeout(__copyResetTimer);
    __copyResetTimer = setTimeout(() => { btnEl.textContent = 'copy'; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => copyViaTextarea(text, done));
  } else {
    copyViaTextarea(text, done);
  }
}
// Fallback for non-secure contexts / browsers without navigator.clipboard:
// a hidden textarea + document.execCommand('copy'), the standard shim.
function copyViaTextarea(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    done(ok);
  } catch (_e) {
    done(false);
  }
}

function quickstartNode(quickstart) {
  if (!quickstart || !Array.isArray(quickstart.lines) || !quickstart.lines.length) return null;
  // A single .cli wrapper holding .ds-cli-row/.ds-cli-comment children, not
  // one .cli per line -- hero-content.css's multi-line wrap rule
  // (.cli:has(.ds-cli-row) { white-space: pre-wrap }) only fires when the
  // rows live inside one shared .cli. One-.cli-per-line instead hit the
  // single-line .cli .cmd { white-space: nowrap } rule, forcing horizontal
  // scroll on any long line (e.g. the importmap script tag).
  const lineNodes = quickstart.lines.map((l, i) => l.kind === 'cmt'
    ? h('div', { key: 'q' + i, class: 'ds-cli-comment' }, l.text)
    : h('div', { key: 'q' + i, class: 'ds-cli-row' },
        h('span', { class: 'prompt' }, '$'),
        h('span', { class: 'cmd' }, l.text)));
  // Copy the whole snippet (comment lines included) as one paste-ready block,
  // not just the command lines -- a reader copying "the quick start" expects
  // what they see, not a silently filtered subset.
  const fullText = quickstart.lines.map((l) => l.text).join('\\n');
  const copyBtn = h('button', {
    type: 'button', class: 'copy ds-quickstart-copy',
    'aria-label': 'copy quick start snippet',
    onclick: (e) => copyQuickstart(fullText, e.currentTarget),
  }, 'copy');
  return C.Panel({
    title: quickstart.heading || 'quick start',
    children: h('div', { class: 'cli ds-quickstart-cli' }, h('div', { class: 'ds-cli-block' }, ...lineNodes), copyBtn),
  });
}

function sideNode(sidebar) {
  if (!sidebar || !Array.isArray(sidebar.sections) || !sidebar.sections.length || !C.Side) return null;
  return C.Side({ sections: sidebar.sections });
}

// minimal client-side markdown renderer matching server-side renderer (idempotent for already-html bodies)
function __slug(s) { return String(s || '').trim().toLowerCase().replace(/[^\\w\\s-]/g, '').replace(/\\s+/g, '-'); }
function __md(md) {
  const lines = String(md || '').split('\\n');
  const out = []; let inCode = false, inList = false;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = (s) => s.replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>').replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
  for (const line of lines) {
    if (line.startsWith('\`\`\`')) { if (inCode) { out.push('</pre>'); inCode = false; } else { out.push('<pre>'); inCode = true; } continue; }
    if (inCode) { out.push(esc(line)); continue; }
    if (line.startsWith('# ')) { const t = line.slice(2); out.push('<h1 id="' + __slug(t) + '">' + esc(t) + '</h1>'); }
    else if (line.startsWith('## ')) { const t = line.slice(3); out.push('<h2 id="' + __slug(t) + '">' + esc(t) + '</h2>'); }
    else if (line.startsWith('### ')) { const t = line.slice(4); out.push('<h3 id="' + __slug(t) + '">' + esc(t) + '</h3>'); }
    else if (line.startsWith('- ')) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inl(esc(line.slice(2))) + '</li>'); }
    else { if (inList) { out.push('</ul>'); inList = false; } if (line.trim()) out.push('<p>' + inl(esc(line)) + '</p>'); }
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</pre>');
  return out.join('\\n');
}

const bodyNode = data.bodyHtml ? C.Section({ children: h('div', { class: 'page-body', innerHTML: data.bodyHtml }) }) : null;

// A real closing block: the page previously just stopped after its last
// panel, leaving nothing but the app-stage's own bottom padding as unexplained
// empty space. Reuses data already on the page (nav links, siteName, year) —
// no invented content.
function footerNode() {
  const year = new Date().getFullYear();
  const links = (data.navItems || []).filter(([, href]) => /^https?:/.test(String(href)));
  // Names the actual maintaining entity, not just the project's numeric
  // brand. This is a personal/community project (MIT, copyright holder
  // "AnEntrypoint" per LICENSE) with no separate legal org behind it, so the
  // footer says that plainly instead of leaving "247420" to stand in for an
  // entity it isn't.
  const entity = (data.seoAuthor || '247420 · a design system by AnEntrypoint').toLowerCase();
  return h('footer', { class: 'ds-page-footer' },
    h('span', { class: 'ds-page-footer-copy' }, String(year) + ' · ' + entity),
    links.length ? h('nav', { class: 'ds-page-footer-links', 'aria-label': 'footer' },
      ...links.map(([label, href], i) => h('a', { key: i, href }, String(label).replace(' ->', '')))
    ) : null,
  );
}

function tierNode(tier, children) {
  const kids = children.filter(Boolean);
  if (!kids.length) return null;
  const labelId = 'tier-' + tier.key + '-label';
  const head = h('div', { key: 'h', class: 'ds-tier-head' },
    h('h2', { class: 'eyebrow', id: labelId }, tier.label),
    tier.lede ? h('p', { class: 'ds-tier-lede' }, tier.lede) : null,
  );
  return h('section', { key: tier.key, class: 'ds-tier ds-tier-' + tier.key, id: tier.key, 'aria-labelledby': labelId }, head, ...kids);
}

const TIERS = [
  { key: 'open', label: 'open', lede: 'browse and try the system running.', ids: ['kits', 'previews', 'decks'], extra: () => [examplesNode(data.examples)] },
  { key: 'ships', label: 'ships', lede: 'what the package contains.', ids: ['file_browser', 'desktop_os', 'web_components', 'api_exports'], extra: () => [] },
  { key: 'read', label: 'read', lede: 'understand the rules behind it.', ids: ['docs', 'features'], extra: () => [quickstartNode(data.quickstart)] },
];

// Builds the whole main-content tree fresh each render so the kits filter
// (module-level kitsFilterState) can drive a real re-render via mount()'s
// own returned render callback -- same reactive shape mountKit() gives every
// other kit on the site, applied here to the static-page renderer.
function buildMainChildren(rerender) {
  const panelsById = new Map((data.panels || []).map((p) => [p.id || p.title || p.name || '', p]));
  const takePanel = (id) => { const p = panelsById.get(id); if (p) panelsById.delete(id); return p ? panelNode(p, 0, rerender) : null; };

  const tierNodes = TIERS.map((t) => {
    const kids = [...t.ids.map(takePanel), ...t.extra()].filter(Boolean);
    if (t.key === 'open' && kids.length) {
      const lead = kids[0];
      if (lead.props) lead.props.class = (lead.props.class || '') + ' ds-tier-lead';
    }
    return tierNode(t, kids);
  });
  const leftoverPanels = [...panelsById.values()].map((p) => panelNode(p, 0, rerender));

  return [
    heroNode(data.hero),
    showcaseNode(data.showcase),
    marqueeNode(data.marquee),
    ...data.sections.map(sectionNode),
    ...tierNodes,
    ...leftoverPanels,
    bodyNode,
    footerNode(),
  ].filter(Boolean);
}

mount(document.getElementById('app'), (rerender) => C.AppShell({
  topbar: C.Topbar({ brand: data.siteName, items: data.navItems, active: data.title }),
  crumb: C.Crumb({ leaf: data.title }),
  side: sideNode(data.sidebar),
  main: h('div', { class: 'app-stage' }, ...buildMainChildren(rerender)),
  status: C.Status({
    left: data.statusLeft || [data.siteName.toLowerCase(), data.slug],
    right: data.statusRight || ['live'],
  }),
}));
`;
