// ModelsConfig — provider/model availability panel, ported from pi-web's
// ModelsConfig.tsx UX (left tree of providers -> models, right detail pane,
// status chips, refresh action) but rebound to freddie's REAL backend shape:
// GET /api/models/availability, not pi-web's editable ~/.pi/agent/models.json.
//
// freddie's schema (see AGENTS.md "Model availability matrix"):
//   {
//     timestamp, config, daemons,
//     providers: [{ id, key_present, discovery_error,
//                    models: [{ id, discovered_via, modes: {<mode>: {ok,
//                      latency_ms, excerpt?, error?, skipped?, reason?}},
//                      usable_in_any_mode }] }],
//     sampler: [{ provider, ok, failCount, nextCheckIn }],
//     summary: { total_providers, total_models, usable_in_any_mode, per_mode_counts },
//   }
// This is a read-only witness of provider reachability, not an editable
// provider-config form — so unlike pi-web's modal editor (add/rename/delete
// provider, edit models.json, save/cancel), this component is a plain
// non-modal panel: pick a provider in the left tree, see its models + mode
// grid + sampler backoff state on the right. No local edit state at all.
//
// Usage (host owns fetch/poll, this component is pure render + callbacks):
//   ModelsConfig({ data, loading, error, selectedProviderId, onSelectProvider,
//                  selectedModel, onSelectModel, onRefresh, rebuilding, onRebuild })
//
// Props:
//   data                : the raw GET /api/models/availability JSON, or null/undefined
//   loading             : true while the initial fetch is in flight
//   error               : { error, hint } from a 404 (file absent) or other fetch failure, or a string
//   selectedProviderId  : id of the provider shown in the detail pane (defaults to first)
//   onSelectProvider    : callback(providerId) fired when a provider row is clicked
//   selectedModel       : { providerId, modelId } OPTIONAL - lets a host (e.g. chat
//                          panel) drive model selection off the same list
//   onSelectModel       : OPTIONAL callback({ providerId, modelId }) fired on model row click
//   onRefresh           : OPTIONAL callback() - re-fetch GET /api/models/availability
//   onRebuild           : OPTIONAL callback() - POST /api/models/availability/rebuild
//   rebuilding          : true while a rebuild job is known in flight (202 seen, not yet settled)
//   rebuildError        : OPTIONAL string - surfaced on a 409 (rebuild already in flight) or other failure
//
// No decorative glyphs — the kit's Icon SVGs + status words only.

import * as webjsx from '../../vendor/webjsx/index.js';
import { Panel, Row } from './content.js';
import { Btn, Icon } from './shell.js';

const h = webjsx.createElement;

const MODES = [
    'direct_api', 'acptoapi_passthrough', 'freddie_v1',
    'kilo_acp', 'opencode_acp', 'claude_cli', 'freddie_agent_loop',
];

const MODE_LABEL = {
    direct_api: 'direct',
    acptoapi_passthrough: 'acptoapi',
    freddie_v1: 'freddie v1',
    kilo_acp: 'kilo acp',
    opencode_acp: 'opencode acp',
    claude_cli: 'claude cli',
    freddie_agent_loop: 'agent loop',
};

function fmtAgo(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return String(iso);
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}

// One cell of the mode-availability grid — a compact chip whose tone/label
// covers all four states a matrix cell can carry: ok, fail, skipped, unknown
// (the model/mode combination is simply absent from `modes`).
function ModeChip({ mode, cell }) {
    const label = MODE_LABEL[mode] || mode;
    if (!cell) {
        return h('span', { class: 'ds-mc-chip tone-unknown', title: label + ': not probed' }, label);
    }
    if (cell.skipped) {
        const reason = cell.reason || 'skipped';
        return h('span', { class: 'ds-mc-chip tone-skip', title: label + ': ' + reason }, label);
    }
    if (cell.ok) {
        const lat = cell.latency_ms != null ? ' ' + cell.latency_ms + 'ms' : '';
        return h('span', { class: 'ds-mc-chip tone-ok', title: label + ': ok' + lat }, label);
    }
    const err = cell.error || 'failed';
    return h('span', { class: 'ds-mc-chip tone-fail', title: label + ': ' + err }, label);
}

function SamplerBadge({ sampler }) {
    if (!sampler) return null;
    const tone = sampler.ok ? 'ok' : 'fail';
    const text = sampler.ok
        ? 'sampler ok'
        : 'sampler backoff' + (sampler.failCount != null ? ' x' + sampler.failCount : '') +
          (sampler.nextCheckIn != null ? ' (retry in ' + sampler.nextCheckIn + ')' : '');
    return h('span', { class: 'ds-mc-sampler tone-' + tone }, text);
}

// Left tree: provider rows (key-present / missing-key / discovery-error state)
// each expanding into its model rows when selected.
function ProviderTree({ providers, samplerById, selectedProviderId, onSelectProvider }) {
    return h('div', { class: 'ds-mc-tree', role: 'listbox', 'aria-label': 'providers' },
        ...providers.map((p) => {
            const isSelected = p.id === selectedProviderId;
            const usableCount = (p.models || []).filter((m) => m.usable_in_any_mode).length;
            const rail = p.discovery_error ? 'flame' : (!p.key_present ? null : (usableCount > 0 ? 'green' : null));
            return h('div', { key: p.id, class: 'ds-mc-tree-group' },
                Row({
                    title: p.id,
                    sub: p.discovery_error
                        ? p.discovery_error
                        : (usableCount + '/' + (p.models || []).length + ' models usable'),
                    meta: h('span', { class: 'ds-mc-key-chip' + (p.key_present ? ' tone-ok' : ' tone-fail') },
                        p.key_present ? 'key set' : 'no key'),
                    rail,
                    selected: isSelected,
                    onClick: () => onSelectProvider && onSelectProvider(p.id),
                }),
                isSelected ? SamplerBadge({ sampler: samplerById.get(p.id) }) : null,
            );
        }));
}

// Right detail: the selected provider's models, each with its mode-grid and
// (optionally) a model-select affordance for a host driving chat model choice.
function ProviderDetail({ provider, samplerById, selectedModel, onSelectModel }) {
    if (!provider) {
        return h('div', { class: 'ds-mc-detail-empty' }, 'select a provider');
    }
    const models = provider.models || [];
    return h('div', { class: 'ds-mc-detail' },
        h('div', { class: 'ds-mc-detail-head' },
            h('span', { class: 'ds-mc-detail-title' }, provider.id),
            SamplerBadge({ sampler: samplerById.get(provider.id) })),
        provider.discovery_error
            ? h('div', { class: 'ds-mc-discovery-error' },
                h('span', { 'aria-hidden': 'true' }, Icon('warn', { size: 14 })),
                h('span', {}, provider.discovery_error))
            : null,
        !models.length
            ? h('div', { class: 'ds-mc-detail-empty' }, 'no models discovered for this provider')
            : h('div', { class: 'ds-mc-model-list' }, ...models.map((m) => {
                const isSelModel = selectedModel && selectedModel.providerId === provider.id && selectedModel.modelId === m.id;
                return h('div', { key: m.id, class: 'ds-mc-model-row' + (isSelModel ? ' active' : '') },
                    h('div', { class: 'ds-mc-model-head' },
                        h('span', { class: 'ds-mc-model-id' }, m.id),
                        h('span', { class: 'ds-mc-model-via' }, m.discovered_via ? 'via ' + m.discovered_via : null),
                        h('span', {
                            class: 'ds-mc-usable-chip' + (m.usable_in_any_mode ? ' tone-ok' : ' tone-fail'),
                        }, m.usable_in_any_mode ? 'usable' : 'unusable'),
                        onSelectModel ? Btn({
                            size: 'sm',
                            variant: isSelModel ? 'default' : 'ghost',
                            children: isSelModel ? 'selected' : 'select',
                            onClick: () => onSelectModel({ providerId: provider.id, modelId: m.id }),
                        }) : null),
                    h('div', { class: 'ds-mc-mode-grid' },
                        ...MODES.map((mode) => ModeChip({ mode, cell: m.modes && m.modes[mode] }))));
            })));
}

function SummaryBar({ summary, timestamp, onRefresh, onRebuild, rebuilding, rebuildError }) {
    return h('div', { class: 'ds-mc-summary' },
        h('div', { class: 'ds-mc-summary-facts' },
            summary ? h('span', {}, (summary.usable_in_any_mode ?? 0) + '/' + (summary.total_models ?? 0) + ' models usable') : null,
            summary ? h('span', {}, summary.total_providers + ' providers') : null,
            timestamp ? h('span', { class: 'ds-mc-summary-ts' }, 'checked ' + fmtAgo(timestamp)) : null),
        h('div', { class: 'ds-mc-summary-actions' },
            rebuildError ? h('span', { class: 'ds-mc-rebuild-error' }, rebuildError) : null,
            onRefresh ? Btn({ size: 'sm', variant: 'ghost', onClick: onRefresh, children: 'refresh' }) : null,
            onRebuild ? Btn({
                size: 'sm',
                disabled: !!rebuilding,
                onClick: onRebuild,
                children: rebuilding ? 'rebuilding…' : 'rebuild',
            }) : null));
}

export function ModelsConfig({
    data, loading, error,
    selectedProviderId, onSelectProvider,
    selectedModel, onSelectModel,
    onRefresh, onRebuild, rebuilding, rebuildError,
} = {}) {
    if (loading && !data) {
        return h('div', { class: 'ds-mc' }, h('div', { class: 'ds-mc-loading', role: 'status' }, 'loading model availability…'));
    }
    // 404 (file absent) per freddie AGENTS.md: {error, hint}. A generic string
    // error is also accepted so a host can pass a plain fetch-failure message.
    if (error) {
        const msg = typeof error === 'string' ? error : (error.error || 'failed to load model availability');
        const hint = typeof error === 'object' ? error.hint : null;
        return h('div', { class: 'ds-mc' },
            h('div', { class: 'ds-mc-empty', role: 'status' },
                h('span', { 'aria-hidden': 'true' }, Icon('circle-dot', { size: 22 })),
                h('span', {}, msg),
                hint ? h('span', { class: 'ds-mc-empty-hint' }, hint) : null,
                onRebuild ? Btn({ size: 'sm', onClick: onRebuild, disabled: !!rebuilding, children: rebuilding ? 'rebuilding…' : 'build availability matrix' }) : null));
    }
    const providers = (data && data.providers) || [];
    if (!providers.length) {
        return h('div', { class: 'ds-mc' },
            h('div', { class: 'ds-mc-empty', role: 'status' },
                h('span', { 'aria-hidden': 'true' }, Icon('circle-dot', { size: 22 })),
                h('span', {}, 'no providers discovered'),
                onRefresh ? Btn({ size: 'sm', variant: 'ghost', onClick: onRefresh, children: 'refresh' }) : null));
    }
    const samplerById = new Map((data.sampler || []).map((s) => [s.provider, s]));
    const activeId = selectedProviderId || providers[0].id;
    const activeProvider = providers.find((p) => p.id === activeId) || providers[0];
    return h('div', { class: 'ds-mc' },
        SummaryBar({ summary: data.summary, timestamp: data.timestamp, onRefresh, onRebuild, rebuilding, rebuildError }),
        h('div', { class: 'ds-mc-body' },
            Panel({
                title: 'providers',
                class: 'ds-mc-tree-panel',
                children: [ProviderTree({ providers, samplerById, selectedProviderId: activeId, onSelectProvider })],
            }),
            Panel({
                title: 'models',
                class: 'ds-mc-detail-panel',
                children: [ProviderDetail({ provider: activeProvider, samplerById, selectedModel, onSelectModel })],
            })));
}
