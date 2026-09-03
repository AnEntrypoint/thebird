// AgentChat's two chrome bars: the agent-then-model picker (with stop/new,
// live status, and host-supplied transcript export actions), and the
// working-directory bar with its roots / recent / inline-browse affordances.

import * as webjsx from '../../../vendor/webjsx/index.js';
import { Select } from '../content.js';
import { Btn } from '../shell.js';
import { BreadcrumbPath } from '../files.js';

const h = webjsx.createElement;

// The agent picker: agent-then-model, not a flat model list. Unavailable agents
// are disabled (unless installable via npx). Ordering is the host's concern.
export function AgentControls({ agents, selectedAgent, models, selectedModel, busy, status, modelsLoading, agentsLoading,
                         onSelectAgent, onSelectModel, onNewChat, onStop, exportActions }) {
  const agentOptions = (agents || []).map((a) => ({
    value: a.id,
    label: a.name + (a.available === false ? (a.npxInstallable ? ' (via npx)' : ' (not installed)') : ''),
    disabled: a.available === false && !a.npxInstallable,
  }));
  const showModels = (models || []).length > 0;
  return h('div', { class: 'agentchat-controls' },
    // While agents load on first boot, show a disabled "loading…" placeholder
    // instead of an empty options list, which is indistinguishable from "this
    // app has no agents configured" (mirrors the models-loading branch below).
    (agentsLoading && !agentOptions.length)
      ? Select({ key: 'agentsel', value: '', placeholder: 'loading agents…', title: 'Loading agents', disabled: true, options: [] })
      : Select({
          key: 'agentsel', value: selectedAgent, placeholder: '— agent —',
          title: 'Select agent', options: agentOptions,
          onChange: (v) => onSelectAgent && onSelectAgent(v),
        }),
    // While models load for a freshly-picked agent, show a disabled "loading…"
    // placeholder so the picker doesn't vanish then reappear (a layout flash).
    showModels
      ? Select({
          key: 'modelsel', value: selectedModel, placeholder: '— model —',
          title: 'Select model', options: (models || []).map((m) => ({ value: m.id, label: m.name || m.id })),
          onChange: (v) => onSelectModel && onSelectModel(v),
        })
      : (modelsLoading
          ? Select({ key: 'modelsel', value: '', placeholder: 'loading models…', title: 'Loading models', disabled: true, options: [] })
          : null),
    busy
      ? Btn({ key: 'stop', onClick: () => onStop && onStop(), children: 'stop', title: 'Stop streaming' })
      : Btn({ key: 'new', onClick: () => onNewChat && onNewChat(), children: 'new', title: 'New chat' }),
    h('span', { key: 'st', class: 'agentchat-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
      h('span', { class: 'status-dot-disc ' + (busy ? 'status-dot-live' : ''), 'aria-hidden': 'true' }),
      h('span', {}, status || (busy ? 'streaming…' : 'ready'))),
    // Host-supplied transcript actions (copy-all / export-md / export-json):
    // small text-labeled buttons riding the same controls row. All siblings in
    // this h(...) call are keyed VElements or null — never bare strings.
    ...(exportActions && exportActions.length
      ? exportActions.map((a, i) => h('button', {
          key: 'exp' + i, type: 'button', class: 'agentchat-export-act',
          title: a.title || a.label,
          onclick: () => a.onClick && a.onClick(),
        }, a.label))
      : []),
  );
}

// A working-directory bar: shows where the agent will run, editable + clearable.
// `error`/`checking` give inline validation feedback while typing/blur (the host
// debounces its /api/stat probe and sets these): a plain-language line renders
// under the input (aria-describedby) and save stays disabled while either is set.
//
// Practicality upgrade: setting cwd by typing an exact absolute path from memory
// was the only path (a fresh user has no way to discover what's even browsable,
// and a regular user re-types/re-remembers the same handful of paths every
// session). Three additive affordances, all optional/host-driven so a host that
// doesn't wire them keeps the old text-only behavior:
//   - `roots` (fsAllowRoots-equivalent): one-click starting points, always
//     visible while editing, not buried in a separate Files-tab-only picker.
//   - `recent` (host's own small MRU list, e.g. localStorage-backed): one-click
//     chips for the last few cwds actually used, so switching between a
//     regular handful of working directories needs no typing at all.
//   - `browse` (host-driven inline directory listing): clicking "browse" asks
//     the host (via onBrowse) to list a directory's subdirectories (reusing
//     the same confined listing endpoint the Files tab already uses), and
//     renders them as a breadcrumb + clickable dir list right in the composer
//     — no round-trip through the Files tab and back required anymore.
export function CwdBar({ cwd, editing, draft, onEdit, onSave, onCancel, onClear, onDraft, error, checking,
                   roots, recent, browse, onBrowseCrumb, onBrowseEnter, onBrowsePick, onBrowseToggle, defaultCwd }) {
  if (editing) {
    const hint = checking ? 'checking…' : (error || null);
    const rootsRow = (roots && roots.length)
      ? h('div', { key: 'roots', class: 'agentchat-cwd-roots', role: 'group', 'aria-label': 'accessible folders' },
          ...roots.map((r, i) => h('button', {
            key: 'root' + i, type: 'button', class: 'agentchat-cwd-chip',
            onclick: () => onDraft && onDraft(r.path || r),
          }, r.label || r.path || r)))
      : null;
    const recentRow = (recent && recent.length)
      ? h('div', { key: 'recent', class: 'agentchat-cwd-recent', role: 'group', 'aria-label': 'recently used folders' },
          h('span', { key: 'rlbl', class: 'agentchat-cwd-recent-label' }, 'recent:'),
          ...recent.map((r, i) => h('button', {
            key: 'rec' + i, type: 'button', class: 'agentchat-cwd-chip',
            title: r, onclick: () => onDraft && onDraft(r),
          }, r.split(/[/\\]/).filter(Boolean).slice(-1)[0] || r)))
      : null;
    const browseToggle = onBrowseToggle
      ? h('button', { key: 'browsetoggle', type: 'button', class: 'agentchat-cwd-btn agentchat-cwd-browse-toggle',
          'aria-expanded': browse ? 'true' : 'false',
          onclick: () => onBrowseToggle() }, browse ? 'hide browser' : 'browse…')
      : null;
    const browsePanel = (browse && browse.entries)
      ? h('div', { key: 'browsepanel', class: 'agentchat-cwd-browse', role: 'group', 'aria-label': 'browse folders' },
          browse.segments ? BreadcrumbPath({ segments: browse.segments, root: browse.rootLabel || 'root', onNav: (i) => onBrowseCrumb && onBrowseCrumb(i) }) : null,
          h('div', { key: 'browselist', class: 'agentchat-cwd-browse-list', role: 'listbox', 'aria-label': 'subdirectories' },
            browse.loading
              ? h('div', { key: 'browseloading', class: 'agentchat-cwd-browse-loading', role: 'status' }, 'loading…')
              : (browse.entries.length
                  ? browse.entries.map((e, i) => h('button', {
                      key: 'be' + i, type: 'button', class: 'agentchat-cwd-browse-item', role: 'option',
                      onclick: () => onBrowseEnter && onBrowseEnter(e.path || e.name),
                    }, e.name || e.path))
                  : h('div', { key: 'browseempty', class: 'agentchat-cwd-browse-empty' }, 'no subfolders here'))),
          h('button', { key: 'browseuse', type: 'button', class: 'agentchat-cwd-btn', onclick: () => onBrowsePick && onBrowsePick(browse.current) }, 'use this folder'))
      : null;
    return h('div', { class: 'agentchat-cwd agentchat-cwd-editing', role: 'group', 'aria-label': 'Set working directory' },
      h('div', { key: 'row1', class: 'agentchat-cwd-row' },
        h('input', { class: 'agentchat-cwd-input', type: 'text', value: draft ?? cwd ?? '',
          placeholder: 'absolute path (blank = server default)',
          'aria-describedby': hint ? 'agentchat-cwd-hint' : null,
          'aria-invalid': error ? 'true' : null,
          'aria-busy': checking ? 'true' : null,
          oninput: (e) => onDraft && onDraft(e.target.value) }),
        browseToggle,
        Btn({ key: 'cancel', onClick: () => onCancel && onCancel(), children: 'cancel' }),
        Btn({ key: 'save', variant: 'primary', disabled: !!(error || checking), onClick: () => onSave && onSave(), children: 'save' })),
      rootsRow,
      recentRow,
      browsePanel,
      hint ? h('span', { key: 'hint', id: 'agentchat-cwd-hint', role: 'status', 'aria-live': 'polite',
        class: 'agentchat-cwd-hint' + (error ? ' is-error' : ' is-checking') }, hint) : null);
  }
  return h('div', { class: 'agentchat-cwd', role: 'group', 'aria-label': 'Working directory' },
    h('span', { class: 'agentchat-cwd-text', title: cwd || 'server default working directory' },
      'cwd: ' + (cwd || 'server default')),
    h('button', { type: 'button', class: 'agentchat-cwd-btn', onclick: () => onEdit && onEdit() }, cwd ? 'change' : 'set'),
    // What "default" resolves to previously wasn't visible until clicked -
    // a title tooltip on the button itself answers that before the click.
    cwd ? h('button', { type: 'button', class: 'agentchat-cwd-btn',
        title: defaultCwd ? ('resets to: ' + defaultCwd) : 'reset to the server default working directory',
        onclick: () => onClear && onClear() }, 'use default') : null);
}
