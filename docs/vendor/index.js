// 247420 design system — main entry.
// Drop-in replacement: same export surface as the published SDK.
//   import { mount, components as C, h, applyDiff, scope } from 'anentrypoint-design';

import * as webjsx from '../vendor/webjsx/index.js';
import { loadCss, scope } from './styles.js';
import { registerDeckStage, getDeckStage } from './deck-stage.js';
import { Router, createRouter } from './router.js';
import * as components from './components.js';
import * as motion from './motion.js';
import * as debug from './debug.js';
import { renderMarkdown, ensureReady as ensureMarkdownReady, sanitizeHtml, isDegraded as isMarkdownDegraded, configureMarkdownCdn, getMarkdownCdnConfig } from './markdown.js';
import { escapeHtml, escapeJson } from './html-escape.js';
import { uid, shortUid } from './uid.js';
import { ensurePrism, highlightAllUnder, configurePrismCdn, getPrismCdnConfig } from './highlight.js';
import { ensureMermaid, renderMermaid, renderMermaidBlocksUnder, configureMermaidCdn, getMermaidCdnConfig } from './mermaid.js';
import { ensureKatex, renderMathBlocksUnder, configureKatexCdn, getKatexCdnConfig } from './math.js';
import { renderPageHtml } from './page-html.js';
import { HeroFromPageData } from './components/content.js';
import { ThemeToggle } from './components/theme-toggle.js';
import { mountKit } from './bootstrap.js';
import * as theme from './theme.js';
import { t, registerLocale, getLocale, setLocale, availableLocales } from './i18n.js';
import { registerChatElement, DsChat } from './web-components/ds-chat.js';
import { registerFreddieChatElement, FreddieChat } from './web-components/freddie-chat.js';
import { formatTime, formatDateTime, formatNumber, formatRelativeTime } from './locale.js';
import { queueMessage, listQueued, flushQueue, watchReconnect, isOnline } from './idb-outbox.js';
import { createVirtualizer, measureRef } from './virtual-scroll.js';
import { applyMotion, getMotion, isMotionReduced, onMotionChange, initMotion } from './motion-toggle.js';

let _installed = false;
export async function installStyles(target) {
    if (_installed && !target) return;
    if (typeof document === 'undefined') return;
    const css = await loadCss();
    const root = target || document.head;
    if (!target && document.querySelector('style[data-247420]')) { _installed = true; return; }
    const tag = document.createElement('style');
    tag.setAttribute('data-247420', '');
    tag.textContent = css;
    root.appendChild(tag);
    if (!target) {
        motion.installMotion();
        _installed = true;
    }
}

// Tracks nodes already mounted via mount() so a second mount() call onto the
// same DOM node fails loud instead of silently layering a second render loop
// (double applyDiff/animateTree on one root corrupts webjsx's diff state).
const _mountedRoots = new WeakSet();

export function mount(rootEl, viewFn, { autoScope = true } = {}) {
    if (!rootEl) throw new Error('mount: rootEl required (received ' + (rootEl === null ? 'null' : typeof rootEl) + ')');
    if (typeof viewFn !== 'function') throw new Error('mount: viewFn required');
    if (_mountedRoots.has(rootEl)) {
        throw new Error('mount: this element is already mounted — call the returned render() to re-render, do not mount() the same root twice');
    }
    _mountedRoots.add(rootEl);
    if (autoScope && rootEl.classList && !rootEl.classList.contains(scope.slice(1))) {
        const cls = scope.slice(1);
        const inheritedFromAncestor = rootEl.closest && rootEl.closest('.' + cls);
        if (!inheritedFromAncestor) rootEl.classList.add(cls);
    }
    // Auto-inject styles (idempotent) so single-line consumers don't need
    // to remember installStyles() before mount.
    installStyles().catch(() => {});
    const render = () => {
        webjsx.applyDiff(rootEl, viewFn(render));
        requestAnimationFrame(() => motion.animateTree(rootEl));
    };
    render();
    return render;
}

// Side-effect: register <ds-chat> + <freddie-chat> as soon as the SDK loads in a browser.
if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
    registerChatElement();
    registerFreddieChatElement();
}

export {
    webjsx, loadCss, scope,
    registerDeckStage, getDeckStage,
    Router, createRouter,
    components, motion, debug, mountKit,
    renderMarkdown, ensureMarkdownReady, sanitizeHtml, isMarkdownDegraded,
    configureMarkdownCdn, getMarkdownCdnConfig,
    ensurePrism, highlightAllUnder, configurePrismCdn, getPrismCdnConfig,
    ensureMermaid, renderMermaid, renderMermaidBlocksUnder, configureMermaidCdn, getMermaidCdnConfig,
    ensureKatex, renderMathBlocksUnder, configureKatexCdn, getKatexCdnConfig,
    registerChatElement, DsChat,
    registerFreddieChatElement, FreddieChat,
    renderPageHtml, HeroFromPageData,
    escapeHtml, escapeJson,
    uid, shortUid,
    theme, ThemeToggle,
    t, registerLocale, getLocale, setLocale, availableLocales,
    formatTime, formatDateTime, formatNumber, formatRelativeTime,
    queueMessage, listQueued, flushQueue, watchReconnect, isOnline,
    createVirtualizer, measureRef,
    applyMotion, getMotion, isMotionReduced, onMotionChange, initMotion
};
export { applyTheme, getTheme, resolvedTheme, onThemeChange, initTheme,
         applyAccent, getAccent, applyDensity, getDensity } from './theme.js';
export { extractAtQuery, buildEntriesFromFiles, filterFileEntries, buildAtInsertText,
         buildAtMentionText, buildFileAtMentionsText } from './file-mention.js';
export const h = webjsx.createElement;
export const applyDiff = webjsx.applyDiff;

// spoint kit paint surfaces (loading screen, HUD, editor chrome).
export { renderLoadingScreen } from './kits/spoint/loading-screen.js';
export { renderGameHud, Crosshair, AmmoCounter, HealthBar, BoostIndicator } from './kits/spoint/game-hud.js';
export { renderHostJoinLobby } from './kits/spoint/host-join-lobby.js';

// Re-export freddie helpers so consumers can `import { FREDDIE_PAGES } from
// 'anentrypoint-design'` directly.
export {
    FREDDIE_PAGES,
    home, chat, voice, sessions, projects, agents, analytics,
    models, cron, skills, config, env, tools, batch, gateway, chains,
    skillLabel, getRecentPaths, saveRecentPath, renderChatMessages,
    fmtBytes, fmtFileSize, fmtTime, fmtAgo, fmtDuration
} from './components.js';

export default {
    webjsx, loadCss, scope, installStyles, mount, h, applyDiff,
    registerDeckStage, getDeckStage, Router, createRouter,
    components, motion, debug, mountKit,
    renderMarkdown, ensurePrism, registerChatElement, renderPageHtml, HeroFromPageData,
    escapeHtml, escapeJson
};
