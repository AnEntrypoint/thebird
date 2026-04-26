/**
 * Clean Light / Dark skin — Hermes dashboard plugin.
 *
 * Every user-created entity (session, skill, cron job, model, compartment)
 * gets a stable, deterministic colour derived from its name.
 * Colours persist across reloads via localStorage and are fully reassignable.
 *
 * Reassignment API (browser console):
 *   window.__debug["cl-skin"].reassign("name", 0-19)
 *   window.__debug["cl-skin"].reset("name")
 *   window.__debug["cl-skin"].resetAll()
 *   window.__debug["cl-skin"].list()        // show all assigned names + indices
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  const PLUGINS = window.__HERMES_PLUGINS__;
  if (!SDK || !PLUGINS) return;

  // Light palette — [bg tint, accent fg]
  const P_LIGHT = [
    ["#fce8e6", "#c5221f"],
    ["#e8f0fe", "#1a73e8"],
    ["#e6f4ea", "#137333"],
    ["#fef7e0", "#b05e00"],
    ["#f3e8fd", "#7b1fa2"],
    ["#e4f7fb", "#007b83"],
    ["#fbe9e7", "#bf360c"],
    ["#f0f4ff", "#3c4499"],
    ["#fff3e0", "#e65100"],
    ["#f9fbe7", "#558b2f"],
    ["#fdf2fa", "#880e4f"],
    ["#e0f7fa", "#006064"],
    ["#fff8e1", "#f57f17"],
    ["#f3e5f5", "#6a1b9a"],
    ["#e8eaf6", "#283593"],
    ["#e0f2f1", "#004d40"],
    ["#fce4ec", "#c62828"],
    ["#e3f2fd", "#0d47a1"],
    ["#f1f8e9", "#33691e"],
    ["#ede7f6", "#4527a0"],
  ];

  // Dark palette — same indices, dark-surface variants
  const P_DARK = [
    ["#4a1512", "#f28b82"],
    ["#1a2f5e", "#8ab4f8"],
    ["#1a3320", "#81c995"],
    ["#3d2e00", "#fdd663"],
    ["#2d1b42", "#d7aefb"],
    ["#003438", "#78d9ec"],
    ["#4a1c0a", "#ffb399"],
    ["#1c2060", "#aab0f5"],
    ["#3d2500", "#ffb974"],
    ["#243014", "#b5e48c"],
    ["#3b0c2a", "#f4b8dc"],
    ["#003035", "#79c6ce"],
    ["#3d2f00", "#fde899"],
    ["#280d42", "#d7b8f5"],
    ["#0d1540", "#9fa8da"],
    ["#00201e", "#80cbc4"],
    ["#3b0c2a", "#f48fb1"],
    ["#0d2240", "#90caf9"],
    ["#1a2e0a", "#aed581"],
    ["#1a0f42", "#b39ddb"],
  ];

  // Detect dark mode via computed background brightness (immune to CSS var tricks)
  function isDark() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!m) return false;
    const lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
    return lum < 128;
  }

  function djb2(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % P_LIGHT.length;
  }

  // Persistent overrides — survive page reload
  const STORE_KEY = "cl-skin-overrides";
  const overrides = new Map(
    JSON.parse(localStorage.getItem(STORE_KEY) || "[]")
  );

  function saveOverrides() {
    localStorage.setItem(STORE_KEY, JSON.stringify([...overrides]));
  }

  // Runtime cache — cleared on dark/light switch detected
  let _lastDark = isDark();
  const cache = new Map();

  function checkThemeSwitch() {
    const dark = isDark();
    if (dark !== _lastDark) { _lastDark = dark; cache.clear(); }
  }

  function indexFor(name) {
    return overrides.has(name) ? overrides.get(name) : djb2(name);
  }

  function colorsFor(name) {
    if (!cache.has(name)) {
      const idx = indexFor(name);
      cache.set(name, _lastDark ? P_DARK[idx] : P_LIGHT[idx]);
    }
    return cache.get(name);
  }

  function accent(name) { return colorsFor(name)[1]; }
  function tint(name, opacity) {
    const [bg] = colorsFor(name);
    return bg + opacity; // hex + 2-char alpha e.g. "66" = 40%
  }

  // ─── Mark element as colored (idempotent per name) ────────────────────────
  function mark(el, name) {
    if (el.dataset.clColored === name) return false;
    el.dataset.clColored = name;
    return true;
  }

  // ─── Compartments (data-compartment attr) ─────────────────────────────────
  function colorCompartments() {
    document.querySelectorAll("[data-compartment]").forEach((el) => {
      const name = el.getAttribute("data-compartment") || "default";
      const [bg] = colorsFor(name);
      el.style.setProperty("--cl-compartment-bg", bg);
    });
  }

  // ─── Entity colouring (sessions, skills, cron jobs) ───────────────────────
  // Every "creatable thing" the user sees becomes a row with:
  //   1. A 4px left-edge swatch in the entity's accent colour.
  //   2. A 33%-tinted row background.
  //   3. Right-click on the swatch → re-roll palette index (deterministic
  //      hash → manual override stored in localStorage).
  //
  // Identity strategy: prefer DOM-stable handles (anchor href / data-id),
  // fall back to a hash of the row's full text snippet so even Untitled
  // rows get distinct colours.
  function rowIdentity(row) {
    const a = row.querySelector('a[href]');
    if (a) {
      const h = a.getAttribute('href');
      const m = h.match(/[?&/]([0-9a-f-]{8,})/i);
      if (m) return m[1];
      return h;
    }
    const id = row.getAttribute('data-id') || row.getAttribute('data-session-id') ||
               row.getAttribute('data-cron-id') || row.getAttribute('data-skill');
    if (id) return id;
    // Fallback: snapshot of the row's text (truncated + collapsed) — stable
    // across renders as long as the row's content doesn't change.
    return (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function ensureSwatch(row, name) {
    let swatch = row.querySelector(':scope > .cl-swatch');
    if (!swatch) {
      swatch = document.createElement('span');
      swatch.className = 'cl-swatch';
      swatch.setAttribute('aria-label', 'entity colour — right-click to re-roll');
      swatch.title = name + ' — right-click to re-roll colour';
      // Position absolute against row (row should be relative)
      const rs = getComputedStyle(row);
      if (rs.position === 'static') row.style.position = 'relative';
      row.insertBefore(swatch, row.firstChild);
      swatch.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = indexFor(name);
        const next = (cur + 1) % P_LIGHT.length;
        window.__debug['cl-skin'].reassign(name, next);
      });
      swatch.addEventListener('click', (e) => {
        // shift+click = reset to default hash
        if (e.shiftKey) {
          e.preventDefault(); e.stopPropagation();
          window.__debug['cl-skin'].reset(name);
        }
      });
    }
    const accent = colorsFor(name)[1];
    swatch.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:4px;background:' + accent +
      ';cursor:context-menu;z-index:1;';
    swatch.dataset.clName = name;
  }

  function paintRow(row, name, bgAlpha) {
    const [bg] = colorsFor(name);
    row.style.backgroundColor = bg + bgAlpha;
    row.style.borderLeft = 'none';
    ensureSwatch(row, name);
  }

  function colorSessions() {
    // "Recent Sessions" card rows. The upstream UI marks them cursor:pointer
    // but ships no onClick handler — so the user thinks the app is broken.
    // Wire each card row to scroll its matching accordion entry into view
    // and expand it. Identity = card row's text snapshot, matched to the
    // accordion list below.
    document.querySelectorAll(
      'div.flex.flex-col.sm\\:flex-row.sm\\:items-center.sm\\:justify-between'
    ).forEach((row) => {
      // Must look like a card row (has Untitled-style title span + a model
      // monospace span). Header bar doesn't match this combo.
      const hasTitle = row.querySelector('span.font-medium, span.text-sm');
      const hasMeta = /\b\d+\s*msgs?\b/.test(row.textContent || '');
      if (!hasTitle || !hasMeta) return;
      const name = rowIdentity(row);
      if (!mark(row, name)) return;
      paintRow(row, name, '33');
      if (row.dataset.clClickHandler === '1') return;
      row.dataset.clClickHandler = '1';
      row.style.cursor = 'pointer';
      row.addEventListener('click', (e) => {
        if (e.target.closest('.cl-swatch')) return;
        if (e.target.closest('button, a, [role="button"]')) return;
        const target = findAccordionRowByText(name);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const trig = target.querySelector('div.cursor-pointer');
        if (trig) {
          // expand if not already
          if (target.getBoundingClientRect().height < 100) trig.click();
          target.style.outline = '2px solid var(--cl-blue)';
          setTimeout(() => { target.style.outline = ''; }, 1200);
        }
      });
    });

    // Accordion rows (long list below). Same identity scheme so clicks
    // on the top card find the matching entry here.
    document.querySelectorAll('div.border.overflow-hidden.transition-colors.border-border').forEach((row) => {
      if (!/\b\d+\s*msgs?\b/.test(row.textContent || '')) return;
      const name = rowIdentity(row);
      if (!mark(row, name)) return;
      paintRow(row, name, '26');
    });
  }

  // Match a card row to its corresponding accordion row by extracting the
  // first-message preview (trailing text between "ago" and the source pill)
  // — that's the most uniquely identifying fragment.
  function findAccordionRowByText(name) {
    // name = "Untitled<model> · N msgs · time ago<preview><source>"
    const previewMatch = name.match(/ago(.+?)(cli|web|api|telegram|discord|slack)?$/i);
    const preview = previewMatch ? previewMatch[1].trim() : '';
    const msgMatch = name.match(/·\s*(\d+)\s*msgs?/i);
    const accs = document.querySelectorAll('div.border.overflow-hidden.transition-colors.border-border');
    for (const a of accs) {
      const t = (a.textContent || '');
      if (preview && !t.includes(preview)) continue;
      if (msgMatch && !t.includes(msgMatch[1] + ' msg')) continue;
      return a;
    }
    return null;
  }

  function colorSkills() {
    document.querySelectorAll('div.group.flex.items-start.gap-3').forEach((row) => {
      const sw = row.querySelector('[role="switch"]');
      if (!sw) return;
      const nameEl = row.querySelector('span.font-mono-ui');
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      if (!name) return;
      if (!mark(row, name)) return;
      paintRow(row, name, '44');
    });
  }

  function colorCronJobs() {
    document.querySelectorAll('div.border.border-border.bg-card\\/80').forEach((card) => {
      const txt = card.textContent || '';
      const hasSchedule = /\d+\s+[\d\*]+\s+[\d\*]+\s+[\d\*]+\s+[\d\*]+/.test(txt);
      const hasPause = card.querySelector('[aria-label*="ause"], [title*="ause"], [aria-label*="rigger"]');
      if (!hasSchedule && !hasPause) return;
      const nameEl = card.querySelector('h3, h4, span.font-semibold, span.font-medium');
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      if (!name || name === 'New Cron Job') return;
      if (!mark(card, name)) return;
      paintRow(card, name, '55');
    });
  }

  // ─── Model name badges (inline text) ──────────────────────────────────────
  // Tint the model name's background only — never recolor text.
  function colorModelBadges() {
    document.querySelectorAll("span.font-mono-ui, code.font-mono-ui").forEach((el) => {
      if (el.closest("div.group.flex.items-start.gap-3")) return;
      const name = el.textContent.trim();
      if (!name || el.dataset.clColored === name) return;
      el.dataset.clColored = name;
      const [bg] = colorsFor(name);
      el.style.backgroundColor = bg + "66";
      el.style.borderRadius = "4px";
      el.style.padding = "1px 6px";
    });
  }

  // ─── data-label badges ────────────────────────────────────────────────────
  function refreshStyleSheet() {
    const id = "cl-skin-entity-styles";
    let styleEl = document.getElementById(id);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = id;
      document.head.appendChild(styleEl);
    }
    const rules = [];
    cache.forEach(([bg], name) => {
      const safe = CSS.escape ? CSS.escape(name) : name.replace(/[^\w-]/g, "_");
      rules.push(
        `[data-compartment="${safe}"] .badge,` +
        `[data-compartment="${safe}"] [data-slot="badge"]{background:${bg}!important;}`
      );
      rules.push(
        `[data-label="${safe}"]{background:${bg}!important;` +
        `border-radius:9999px!important;padding:2px 8px!important;` +
        `font-size:0.6875rem!important;font-weight:500!important;}`
      );
    });
    styleEl.textContent = rules.join("\n");
  }

  // ─── Inbox polish stylesheet (injected once, plugin-owned) ───────────────
  // Theme YAML's customCSS is capped at 32 KB by the backend; the plugin can
  // append unlimited CSS via a <style> tag. Keep large polish blocks here.
  const POLISH_CSS = `
    /* Active nav: red bg, dark text (Inbox-style), red icon */
    aside a[aria-current="page"], aside a.active {
      background: var(--cl-red-light) !important;
      color: var(--cl-text-1) !important;
      font-weight: 700 !important;
    }
    aside a[aria-current="page"] svg, aside a.active svg {
      color: var(--cl-red) !important;
    }

    /* Toggle switches — Material pill style */
    button[role="switch"] {
      border-radius: 9999px !important;
      width: 36px !important;
      height: 20px !important;
      padding: 0 !important;
      background: var(--cl-divider-strong) !important;
      transition: background 0.15s !important;
      box-shadow: none !important;
    }
    button[role="switch"][aria-checked="true"] {
      background: var(--cl-blue) !important;
    }
    button[role="switch"] > span {
      width: 16px !important;
      height: 16px !important;
      border-radius: 9999px !important;
      background: #fff !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.2) !important;
      transition: transform 0.15s !important;
      margin: 2px !important;
      transform: translateX(0) !important;
    }
    button[role="switch"][aria-checked="true"] > span {
      transform: translateX(16px) !important;
    }

    /* Secondary aside header rows (Filters, Sections labels) — keep tight,
       small, left-aligned. Don't inherit the border-border first-child
       padding rule that puffs them up. */
    aside.sm\\:w-56 div.flex.flex-col.border > div:first-child,
    aside[class*="sm:w-56"] div.flex.flex-col.border > div:first-child {
      padding: 8px 12px !important;
      background: transparent !important;
      font-size: 0.6875rem !important;
      font-weight: 500 !important;
      color: var(--cl-text-3) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      justify-content: flex-start !important;
    }
    aside.sm\\:w-56 div.flex.flex-col.border > div:nth-child(2),
    aside[class*="sm:w-56"] div.flex.flex-col.border > div:nth-child(2) {
      padding: 8px 12px 4px !important;
      font-size: 0.6875rem !important;
      font-weight: 500 !important;
      color: var(--cl-text-3) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
    }
    /* The "Filters" badge text inside the header row — stop being centered+blue */
    aside.sm\\:w-56 div.flex.flex-col.border > div:first-child span,
    aside[class*="sm:w-56"] div.flex.flex-col.border > div:first-child span {
      font-size: 0.6875rem !important;
      color: var(--cl-text-3) !important;
      letter-spacing: 0.08em !important;
      text-align: left !important;
      flex: 0 1 auto !important;
    }
    /* Card outer — kill the bg-muted/20 grey rect, just stack the parts */
    aside.sm\\:w-56 div.flex.flex-col.border,
    aside[class*="sm:w-56"] div.flex.flex-col.border {
      background: transparent !important;
    }

    /* Secondary aside (Config / Skills filter pills) — give the sticky panel
       breathing room at top + bottom and an own scroll-padding so the first
       pill is never clipped. */
    aside.sm\\:w-56 div.sm\\:sticky, aside[class*="sm:w-56"] div[class*="sm:sticky"] {
      top: 16px !important;
      padding-top: 8px !important;
    }
    aside.sm\\:w-56 div[class*="overflow-y-auto"],
    aside[class*="sm:w-56"] div[class*="overflow-y-auto"] {
      scroll-padding-top: 12px !important;
      padding-top: 8px !important;
    }

    /* Helper text (description right under the label) — small italic muted */
    main label + span.text-xs.text-muted-foreground\\/70,
    main label ~ span[class*="text-muted-foreground"][class*="text-xs"] {
      display: block !important;
      font-size: 0.75rem !important;
      font-weight: 400 !important;
      font-style: italic !important;
      color: var(--cl-text-3) !important;
      margin: -2px 0 6px 0 !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
      opacity: 1 !important;
    }
    /* Tighter form-field gap so label + helper + input read as one block */
    main div.grid.gap-1\\.5, main div.grid.gap-2 {
      gap: 4px !important;
    }

    /* Form inputs (text / textarea / select) — Material filled style with
       visible bg distinct from card surface, so the field is identifiable. */
    main input:not([type="search"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]),
    main textarea, main select {
      background: var(--cl-input-bg) !important;
      color: var(--cl-text-1) !important;
      border-radius: 4px 4px 0 0 !important;
      padding: 12px 12px 10px !important;
      border-bottom: 2px solid transparent !important;
      transition: background 0.15s, border-color 0.15s !important;
    }
    main input:not([type="search"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):hover,
    main textarea:hover, main select:hover {
      background: var(--cl-input-hover) !important;
    }
    main input:not([type="search"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):focus,
    main textarea:focus, main select:focus {
      background: var(--cl-input-hover) !important;
      border-bottom-color: var(--cl-blue) !important;
      outline: none !important;
    }
    main input::placeholder, main textarea::placeholder {
      color: var(--cl-text-3) !important;
      opacity: 1 !important;
    }

    /* Search input: clear leading-icon overlap, big pill */
    input[type="search"], input[placeholder*="Search"], input[placeholder*="search"] {
      padding-left: 56px !important;
      height: 48px !important;
      font-size: 0.875rem !important;
      background: var(--cl-hover) !important;
      border-radius: 8px !important;
      box-shadow: none !important;
      max-width: 720px !important;
      width: 100% !important;
    }
    input[type="search"]:hover, input[placeholder*="Search"]:hover {
      background: var(--cl-input-hover, var(--cl-divider, rgba(0,0,0,0.04))) !important;
    }
    input[type="search"]:focus, input[placeholder*="Search"]:focus {
      background: var(--cl-surface) !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04) !important;
      outline: none !important;
    }
    .relative > svg.lucide-search,
    .relative > svg[class*="search"] {
      color: var(--cl-text-3) !important;
      width: 20px !important; height: 20px !important;
      left: 18px !important;
    }

    /* Page title h1 */
    main h1, header h1 {
      font-size: 1.375rem !important;
      font-weight: 400 !important;
      color: var(--cl-text-1) !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
    }
    /* Title-adjacent count badge — Inbox unread style */
    main h1 + [data-slot="badge"], main h2 + [data-slot="badge"],
    main h1 + span[class*="rounded"], main h2 + span[class*="rounded"] {
      background: transparent !important;
      color: var(--cl-text-3) !important;
      font-size: 0.75rem !important;
      font-weight: 500 !important;
      padding: 0 0 0 8px !important;
      letter-spacing: 0 !important;
    }

    /* Section labels (Recent Sessions, Daily Token Usage, etc.) */
    main h2, main h3 {
      font-size: 0.6875rem !important;
      font-weight: 500 !important;
      color: var(--cl-text-3) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      margin: 0 0 8px 0 !important;
    }
    main h2 svg, main h3 svg {
      color: var(--cl-text-3) !important;
      width: 14px !important; height: 14px !important;
    }

    main span.font-medium { font-weight: 500 !important; color: var(--cl-text-1) !important; }
    main [class*="text-muted-foreground"] { color: var(--cl-text-2) !important; }

    /* Stat tiles */
    main [class*="grid"] > [class*="bg-card"],
    main [class*="grid"] > div[class*="rounded"] {
      background: var(--cl-surface) !important;
      border-radius: 8px !important;
      padding: 20px 24px !important;
      box-shadow: none !important;
    }
    main [class*="text-2xl"], main [class*="text-3xl"], main [class*="text-4xl"] {
      font-weight: 400 !important;
      color: var(--cl-text-1) !important;
      letter-spacing: -0.01em !important;
    }

    /* Primary CTA: blue Material flat.
       Match buttons that are clearly text+optional-icon CTAs (have a non-trivial
       width like h-8/h-9/h-10 + px-3+ + visible text), but exclude:
         - icon-only square buttons (w-7/w-8 + h-7/h-8)
         - h-7 range chips (no w-7)
         - rounded-full pills */
    button[class~="bg-foreground"]:not([class*="w-7"]):not([class*="w-8"]):not([class*="rounded-full"]):not([class*="size-"]):not([class*="h-7"]),
    button[class~="bg-foreground/90"]:not([class*="w-7"]):not([class*="w-8"]):not([class*="rounded-full"]):not([class*="h-7"]),
    button[data-variant="default"] {
      background: var(--cl-blue) !important;
      color: #ffffff !important;
      border-radius: 8px !important;
      height: 36px !important;
      padding: 0 24px !important;
      font-weight: 500 !important;
      font-size: 0.875rem !important;
      box-shadow: 0 1px 2px rgba(60,64,67,0.15) !important;
    }
    button[class~="bg-foreground"]:not([class*="w-7"]):not([class*="w-8"]):not([class*="rounded-full"]):not([class*="h-7"]):hover,
    button[data-variant="default"]:hover {
      background: #1557b0 !important;
      box-shadow: 0 1px 3px rgba(60,64,67,0.25), 0 2px 6px rgba(60,64,67,0.10) !important;
    }
    button[class~="bg-foreground"]:not([class*="w-7"]):not([class*="w-8"]):not([class*="rounded-full"]):not([class*="h-7"]) svg,
    button[data-variant="default"] svg { color: #ffffff !important; }

    /* Small icon-only buttons (h-7 w-7) — Inbox round hover chip */
    button[class*="h-7"][class*="w-7"], button[class*="size-7"],
    button[class*="h-8"][class*="w-8"], button[class*="size-8"] {
      background: transparent !important;
      border-radius: 9999px !important;
      box-shadow: none !important;
      color: var(--cl-text-2) !important;
    }
    button[class*="h-7"][class*="w-7"]:hover, button[class*="size-7"]:hover,
    button[class*="h-8"][class*="w-8"]:hover, button[class*="size-8"]:hover {
      background: var(--cl-hover) !important;
    }

    /* Range chips — h-7 buttons (7d/30d/90d/Refresh). Live in header, not
       main. Match anywhere; exclude w-7 icon-only buttons. */
    button[class*="h-7"]:not([class*="w-7"]) {
      background: transparent !important;
      color: var(--cl-text-2) !important;
      border-radius: 9999px !important;
      height: 32px !important;
      padding: 0 14px !important;
      font-size: 0.8125rem !important;
      font-weight: 500 !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
      box-shadow: none !important;
    }
    button[class*="h-7"]:not([class*="w-7"]):hover { background: var(--cl-hover) !important; }
    /* Active range chip = light-blue chip, blue text */
    button[class*="h-7"][class~="bg-foreground/90"],
    button[class*="h-7"][class~="bg-foreground"],
    button[class*="h-7"][aria-pressed="true"],
    button[class*="h-7"][data-state="active"] {
      background: var(--cl-blue-light) !important;
      color: var(--cl-blue) !important;
      box-shadow: none !important;
    }

    /* Sentence-case all body text in main; only h2/h3/labels stay uppercase. */
    main div, main p, main span, main button, main td, main a {
      text-transform: none !important;
      letter-spacing: 0 !important;
    }
    main h2, main h3, main label {
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
    }
    /* Override the older yaml rule that uppercases first-child header rows
       inside [class*="border-border"] containers — only apply that uppercase
       treatment to elements that are clearly section heads (h2/h3/h4),
       not to text body divs that happen to be first child. */
    [class*="border-border"] > div:first-child:not(:has(h2)):not(:has(h3)):not(:has(h4)),
    [class*="p-4 border-b"]:not(:has(h2)):not(:has(h3)):not(:has(h4)) {
      text-transform: none !important;
      letter-spacing: 0 !important;
      font-size: 0.875rem !important;
      font-weight: 400 !important;
      color: var(--cl-text-2) !important;
    }
    /* And specifically force empty-state center text to look friendly */
    [class*="text-center"][class*="text-muted-foreground"] {
      text-transform: none !important;
      letter-spacing: 0 !important;
      font-size: 0.875rem !important;
      font-weight: 400 !important;
      color: var(--cl-text-2) !important;
      padding: 32px 0 !important;
    }
    /* Empty-state center text (e.g. "No cron jobs configured…") — but NOT
       inside the secondary aside, which has its own uppercase section labels
       (Filters, Sections) that must stay tight. */
    main [class*="text-center"][class*="text-muted"]:not(aside *),
    main p[class*="uppercase"]:not(aside *):not(label),
    main div[class*="uppercase"][class*="text-center"]:not(aside *) {
      font-size: 0.875rem !important;
      letter-spacing: 0 !important;
      font-weight: 400 !important;
      color: var(--cl-text-2) !important;
      padding: 32px 0 !important;
    }

    /* Form labels */
    main label {
      font-size: 0.6875rem !important;
      font-weight: 500 !important;
      color: var(--cl-text-3) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.08em !important;
      margin-bottom: 4px !important;
      display: block !important;
    }

    /* Table headers — sentence case */
    table th {
      text-transform: none !important;
      letter-spacing: 0 !important;
      font-size: 0.75rem !important;
      font-weight: 500 !important;
      color: var(--cl-text-3) !important;
      padding: 10px 16px !important;
    }
    table td { padding: 12px 16px !important; font-size: 0.875rem !important; }

    /* Sidebar footer block — System / Gateway / Restart / Update / Theme / Lang */
    aside > div[class*="shrink-0"][class*="flex-col"] {
      background: var(--cl-bg) !important;
      padding: 8px 0 !important;
    }
    /* Section label (System) — small uppercase muted but legible */
    aside > div[class*="shrink-0"] > span[class*="opacity"] {
      opacity: 1 !important;
      color: var(--cl-text-3) !important;
      font-size: 0.6875rem !important;
      letter-spacing: 0.08em !important;
      text-transform: uppercase !important;
      font-weight: 500 !important;
      padding: 4px 16px !important;
    }
    /* Gateway Status / Active Sessions row */
    aside > div[class*="shrink-0"] a[title="Status overview"] {
      color: var(--cl-text-2) !important;
      padding: 4px 16px 8px !important;
    }
    aside > div[class*="shrink-0"] a[title="Status overview"] * {
      color: var(--cl-text-2) !important;
      opacity: 1 !important;
      font-size: 0.75rem !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
      line-height: 1.4 !important;
    }
    aside > div[class*="shrink-0"] a[title="Status overview"] span.text-muted-foreground\\/50,
    aside > div[class*="shrink-0"] a[title="Status overview"] span[class*="text-muted-foreground/50"] {
      color: var(--cl-text-3) !important;
    }
    /* Action pill rows (Restart Gateway / Update Thoth / Theme / Lang) */
    aside > div[class*="shrink-0"] button {
      background: transparent !important;
      color: var(--cl-text-1) !important;
      font-size: 0.75rem !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
      font-weight: 500 !important;
      padding: 6px 12px !important;
      border-radius: 9999px !important;
      transition: background 0.12s !important;
      opacity: 1 !important;
    }
    aside > div[class*="shrink-0"] button:hover { background: var(--cl-hover) !important; }
    aside > div[class*="shrink-0"] button svg {
      color: var(--cl-text-2) !important;
      width: 14px !important;
      height: 14px !important;
    }
    /* Final row (Clean Dark / GB EN / version) — sit on the bottom */
    aside > div[class*="border-t"]:last-child {
      background: var(--cl-bg) !important;
      color: var(--cl-text-3) !important;
      padding: 8px 16px !important;
      font-size: 0.6875rem !important;
    }
    aside > div[class*="border-t"]:last-child * {
      color: var(--cl-text-3) !important;
      opacity: 1 !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
    }

    /* Log lines — theme-aware via custom properties so dark mode picks
       dark surface/foreground variants automatically. */
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"],
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div {
      background: var(--cl-surface) !important;
      color: var(--cl-text-1) !important;
    }
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div:nth-child(even) {
      background: var(--cl-surface-2) !important;
    }
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div:hover {
      background: var(--cl-hover) !important;
    }
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div.text-warning,
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div[class*="text-warning"] {
      color: var(--cl-severity-warn-fg) !important;
      background: var(--cl-severity-warn-bg) !important;
    }
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div.text-warning:nth-child(even),
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div[class*="text-warning"]:nth-child(even) {
      background: var(--cl-severity-warn-bg-alt) !important;
    }
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div.text-destructive,
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div[class*="text-destructive"],
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div[class*="text-error"] {
      color: var(--cl-severity-error-fg) !important;
      background: var(--cl-severity-error-bg) !important;
    }
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div.text-success,
    div[class*="font-mono"][class*="text-xs"][class*="overflow-auto"] > div[class*="text-success"] {
      color: var(--cl-severity-success-fg) !important;
      background: var(--cl-severity-success-bg) !important;
    }

    /* CLI / source pill on the right of a session row */
    [class*="rounded-full"][class*="px-"][class*="text-xs"],
    span[class*="bg-muted"][class*="rounded"] {
      background: var(--cl-surface-2) !important;
      color: var(--cl-text-2) !important;
      font-size: 0.6875rem !important;
      font-weight: 500 !important;
      padding: 2px 8px !important;
      border-radius: 9999px !important;
      text-transform: uppercase !important;
      letter-spacing: 0.04em !important;
    }
  `;

  function injectPolish() {
    let s = document.getElementById('cl-skin-polish');
    if (!s) {
      s = document.createElement('style');
      s.id = 'cl-skin-polish';
      s.textContent = POLISH_CSS;
    }
    // Always re-append at end of <head> so we win the cascade against any
    // stylesheet (Tailwind, theme.customCSS, vite HMR-injected) that mounts
    // after us.
    if (document.head.lastElementChild !== s) {
      document.head.appendChild(s);
    }
  }

  // ─── Brand rename: Hermes → Thoth ─────────────────────────────────────────
  // Replace text content only — never touch attributes, ids, classes.
  function renameBrand(root) {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      if (v && /Hermes/.test(v)) hits.push(n);
    }
    hits.forEach(n => { n.nodeValue = n.nodeValue.replace(/Hermes/g, "Thoth"); });
    if (/Hermes/.test(document.title)) {
      document.title = document.title.replace(/Hermes/g, "Thoth");
    }
  }

  // ─── Brand mark fix-up ────────────────────────────────────────────────────
  // Source DOM: header span = `Thoth<br>Agent`, diamond logo in its own row
  // below. Make it inbox: single row = small diamond + single-line wordmark.
  const DIAMOND_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="cl-brand-logo" ' +
    'viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 2 L26 14 L14 26 L2 14 Z"/></svg>';

  function fixBrandMark() {
    const aside = document.querySelector('aside.fixed');
    if (!aside) return;
    const header = aside.children[0];
    if (!header) return;

    // 1. Replace <br> in wordmark with a space; force single line.
    const wordmark = header.querySelector('span.text-midground');
    if (wordmark && wordmark.querySelector('br')) {
      wordmark.querySelectorAll('br').forEach(br => br.replaceWith(' '));
      wordmark.style.whiteSpace = 'nowrap';
      wordmark.style.lineHeight = '1';
    }

    // 2. Hide every sibling row whose ONLY visible content is a 28x28 diamond
    //    SVG (the original logo row). Detect by: small height, single svg
    //    with viewBox '0 0 28 28', no text.
    for (let i = 1; i < aside.children.length; i++) {
      const ch = aside.children[i];
      if (ch.dataset.clLogoRowHandled === '1') continue;
      const text = (ch.textContent || '').trim();
      if (text) continue;
      const svgs = ch.querySelectorAll('svg');
      if (svgs.length !== 1) continue;
      if (svgs[0].getAttribute('viewBox') !== '0 0 28 28') continue;
      ch.style.display = 'none';
      ch.dataset.clLogoRowHandled = '1';
    }

    // 3. Inject our own diamond into the header before the wordmark, once.
    //    Drop any stale cloned mark that doesn't match our diamond viewBox.
    header.querySelectorAll('svg.cl-brand-logo').forEach(s => {
      if (s.getAttribute('viewBox') !== '0 0 28 28') s.remove();
    });
    if (wordmark && !header.querySelector('svg.cl-brand-logo')) {
      const tpl = document.createElement('template');
      tpl.innerHTML = DIAMOND_SVG.trim();
      const svg = tpl.content.firstChild;
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.style.cssText = 'flex-shrink:0;width:24px;height:24px;color:#d93025;';
      wordmark.parentNode.insertBefore(svg, wordmark);
    }
  }

  // ─── Main scan ────────────────────────────────────────────────────────────
  function scan() {
    checkThemeSwitch();
    colorCompartments();
    colorSessions();
    colorSkills();
    colorCronJobs();
    colorModelBadges();
    refreshStyleSheet();
    renameBrand();
    fixBrandMark();
    injectPolish();
  }

  function startObserver() {
    const obs = new MutationObserver(scan);
    obs.observe(document.body, { subtree: true, childList: true,
      attributes: true, attributeFilter: ["data-compartment", "class"] });
  }

  function clearStaleMarkers() {
    document.querySelectorAll("[data-cl-colored]").forEach(el => {
      delete el.dataset.clColored;
    });
  }

  function init() { clearStaleMarkers(); scan(); startObserver(); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  setInterval(scan, 3000);

  // ─── Public API ──────────────────────────────────────────────────────────
  window.__debug = window.__debug || {};
  window.__debug["cl-skin"] = {
    palettes: { light: P_LIGHT, dark: P_DARK },
    cache, overrides,
    getColors: colorsFor,
    rescan: scan,

    list() {
      const out = [];
      cache.forEach(([bg, fg], name) => {
        out.push({ name, index: indexFor(name), bg, fg, override: overrides.has(name) });
      });
      return out;
    },

    reassign(name, idx) {
      if (idx < 0 || idx >= P_LIGHT.length)
        throw new RangeError(`idx must be 0-${P_LIGHT.length - 1}`);
      overrides.set(name, idx);
      saveOverrides();
      cache.delete(name);
      const safe = CSS.escape ? CSS.escape(name) : name.replace(/[^\w-]/g, "_");
      document.querySelectorAll(`[data-cl-colored="${safe}"]`).forEach(el => {
        delete el.dataset.clColored;
        el.style.removeProperty("border-left");
        el.style.removeProperty("background-color");
        el.style.removeProperty("color");
        el.querySelectorAll(":scope > .cl-swatch").forEach(s => s.remove());
        el.querySelectorAll("[data-cl-title]").forEach(t => {
          delete t.dataset.clTitle;
          t.style.removeProperty("color");
          t.style.removeProperty("font-weight");
        });
      });
      scan();
    },

    reset(name) {
      overrides.delete(name);
      saveOverrides();
      cache.delete(name);
      const safe = CSS.escape ? CSS.escape(name) : name.replace(/[^\w-]/g, "_");
      document.querySelectorAll(`[data-cl-colored="${safe}"]`).forEach(el => {
        delete el.dataset.clColored;
        el.style.removeProperty("border-left");
        el.style.removeProperty("background-color");
        el.style.removeProperty("color");
        el.querySelectorAll(":scope > .cl-swatch").forEach(s => s.remove());
        el.querySelectorAll("[data-cl-title]").forEach(t => {
          delete t.dataset.clTitle;
          t.style.removeProperty("color");
          t.style.removeProperty("font-weight");
        });
      });
      scan();
    },

    resetAll() {
      overrides.clear();
      saveOverrides();
      cache.clear();
      document.querySelectorAll("[data-cl-colored]").forEach(el => {
        delete el.dataset.clColored;
        el.style.removeProperty("border-left");
        el.style.removeProperty("background-color");
        el.style.removeProperty("color");
        el.querySelectorAll(":scope > .cl-swatch").forEach(s => s.remove());
      });
      document.querySelectorAll("[data-cl-title]").forEach(t => {
        delete t.dataset.clTitle;
        t.style.removeProperty("color");
        t.style.removeProperty("font-weight");
      });
      scan();
    },
  };

  if (PLUGINS.register) {
    PLUGINS.register("clean-skin", () =>
      (SDK.React || window.React).createElement(
        "div",
        { style: { padding: "1rem", color: "#5f6368", fontSize: "0.875rem" } },
        "Clean Light skin active — entity colours applied.",
      ),
    );
  }

})();
