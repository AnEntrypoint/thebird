// PluginsConfig — plugin/extension list + detail panel, ported from pi-web's
// PluginsConfig.tsx UX (modal, sidebar list grouped by scope, detail pane with
// enable/disable toggle, add-plugin flow, diagnostics footer) but rebuilt over
// freddie's real plugin contract, not pi-web's npm-package model:
//
//   { name, version?, surfaces: 'pi'|'gui'|'both', requires?: [...names], source? }
//
// (see freddie's AGENTS.md "Plugin architecture" — `src/host/contract.js`).
// There is no install/remove/update here: freddie plugins are local-filesystem
// discovery only (`plugins/<name>/plugin.js`, `~/.freddie/plugins/`), so the
// only host-facing actions are enable/disable and reload. `requires` renders
// as a dependency list (freddie's cycle-checked `requires` array) in place of
// pi-web's package version/resource breakdown.
//
// Usage (consumer wires its own state/fetch, this is presentation-only):
//   PluginsConfig({ plugins, selected, onSelect, onToggle, onReload, onClose })
//
// Props:
//   plugins   : [{ name, version?, surfaces, requires?, source?, enabled, status? }]
//               status is an optional free-text chip ('loaded'|'error'|...);
//               enabled drives the toggle and the sidebar status dot.
//   selected  : name of the currently-selected plugin, or null
//   loading   : bool — sidebar shows a loading row instead of the list
//   error     : string|null — sidebar shows this instead of the list
//   busyName  : name of the plugin currently mid-toggle/reload, or null
//   onSelect  : (name) => void
//   onToggle  : (plugin) => void — fired with the full plugin row to flip enabled
//   onReload  : () => void — optional, re-run host discovery
//   onClose   : () => void
//
// No decorative glyphs beyond the kit's Icon SVGs — status communicated by a
// tone dot + text label, never color alone.

import * as webjsx from '../../vendor/webjsx/index.js';
import { Icon } from './shell.js';
const h = webjsx.createElement;

function statusTone(plugin) {
    if (!plugin.enabled) return 'neutral';
    if (plugin.status === 'error') return 'delete';
    return 'add';
}

function statusLabel(plugin) {
    if (!plugin.enabled) return 'disabled';
    if (plugin.status) return plugin.status;
    return 'enabled';
}

function surfacesText(surfaces) {
    if (!surfaces) return '—';
    return surfaces;
}

function PluginSidebarRow({ plugin, active, busy, onSelect }) {
    return h('button', {
        type: 'button',
        class: 'ds-plugins-row' + (active ? ' active' : ''),
        onclick: () => onSelect(plugin.name),
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': plugin.name + ': ' + statusLabel(plugin),
    },
        h('span', { class: 'ds-plugins-dot tone-' + statusTone(plugin), 'aria-hidden': 'true' }),
        h('span', { class: 'ds-plugins-row-body' },
            h('span', { class: 'ds-plugins-row-name' }, plugin.name),
            h('span', { class: 'ds-plugins-row-meta' },
                surfacesText(plugin.surfaces),
                plugin.requires && plugin.requires.length ? ' · ' + plugin.requires.length + ' req' : '')),
        busy ? h('span', { class: 'ds-plugins-row-busy' }, '…') : null);
}

function PluginDetail({ plugin, busy, onToggle, onReload }) {
    if (!plugin) {
        return h('div', { class: 'ds-plugins-empty', role: 'status' },
            h('span', { 'aria-hidden': 'true' }, Icon('circle-dot', { size: 22 })),
            h('span', {}, 'Select a plugin'));
    }
    const requires = Array.isArray(plugin.requires) ? plugin.requires : [];
    return h('div', { class: 'ds-plugins-detail' },
        h('div', { class: 'ds-plugins-detail-head' },
            h('div', { class: 'ds-plugins-detail-title' },
                h('span', { class: 'ds-plugins-dot tone-' + statusTone(plugin), 'aria-hidden': 'true' }),
                h('span', { class: 'name' }, plugin.name),
                plugin.version ? h('span', { class: 'ds-plugins-version' }, 'v' + plugin.version) : null),
            h('button', {
                type: 'button',
                class: 'ds-plugins-toggle' + (plugin.enabled ? ' on' : ''),
                disabled: busy ? true : null,
                onclick: () => onToggle && onToggle(plugin),
                'aria-pressed': plugin.enabled ? 'true' : 'false',
                'aria-label': plugin.enabled ? 'Disable plugin' : 'Enable plugin',
            }, h('span', { class: 'ds-plugins-toggle-knob' }))),
        h('div', { class: 'ds-plugins-fact-grid' },
            h('div', { class: 'ds-plugins-fact-label' }, 'status'),
            h('div', { class: 'ds-plugins-fact-value tone-text-' + statusTone(plugin) }, statusLabel(plugin)),
            h('div', { class: 'ds-plugins-fact-label' }, 'surfaces'),
            h('div', { class: 'ds-plugins-fact-value' }, surfacesText(plugin.surfaces)),
            plugin.source ? h('div', { class: 'ds-plugins-fact-label' }, 'source') : null,
            plugin.source ? h('div', { class: 'ds-plugins-fact-value ds-plugins-mono' }, plugin.source) : null),
        h('div', { class: 'ds-plugins-requires' },
            h('div', { class: 'ds-plugins-group-label' }, 'requires'),
            requires.length
                ? h('div', { class: 'ds-plugins-requires-list' },
                    ...requires.map((r) => h('span', { key: r, class: 'ds-plugins-chip' }, r)))
                : h('div', { class: 'ds-plugins-requires-empty' }, 'no dependencies')),
        onReload
            ? h('div', { class: 'ds-plugins-detail-actions' },
                h('button', {
                    type: 'button',
                    class: 'ds-plugins-btn',
                    disabled: busy ? true : null,
                    onclick: onReload,
                }, busy ? 'Reloading…' : 'Reload plugins'))
            : null);
}

export function PluginsConfig({
    plugins = [],
    selected = null,
    loading = false,
    error = null,
    busyName = null,
    onSelect,
    onToggle,
    onReload,
    onClose,
} = {}) {
    const selectedPlugin = plugins.find((p) => p.name === selected) || null;
    return h('div', { class: 'ds-plugins-overlay', onclick: (e) => { if (e.target === e.currentTarget && onClose) onClose(); } },
        h('div', { class: 'ds-plugins-modal', role: 'dialog', 'aria-label': 'Plugins' },
            h('div', { class: 'ds-plugins-header' },
                h('span', { class: 'ds-plugins-title' }, 'Plugins'),
                onClose ? h('button', { type: 'button', class: 'ds-plugins-close', onclick: onClose, 'aria-label': 'Close' }, '×') : null),
            h('div', { class: 'ds-plugins-body' },
                h('div', { class: 'ds-plugins-sidebar' },
                    loading
                        ? h('div', { class: 'ds-plugins-sidebar-status' }, 'Loading…')
                        : error
                            ? h('div', { class: 'ds-plugins-sidebar-status ds-plugins-status-error' }, error)
                            : plugins.length === 0
                                ? h('div', { class: 'ds-plugins-sidebar-status' }, 'No plugins registered')
                                : h('div', { class: 'ds-plugins-list', role: 'listbox', 'aria-label': 'plugin list' },
                                    ...plugins.map((p) => PluginSidebarRow({
                                        key: p.name,
                                        plugin: p,
                                        active: selected === p.name,
                                        busy: busyName === p.name,
                                        onSelect,
                                    })))),
                h('div', { class: 'ds-plugins-main' },
                    PluginDetail({ plugin: selectedPlugin, busy: busyName === (selectedPlugin && selectedPlugin.name), onToggle, onReload }))),
            h('div', { class: 'ds-plugins-footer' },
                h('span', { class: 'ds-plugins-footer-count' }, plugins.length + ' plugin' + (plugins.length === 1 ? '' : 's')))));
}
