// Shared chat configuration surface for thebird's freddie chat surfaces.
//
// Renders a compact, collapsible config strip (model / agent / skills / working
// folder / plugins / acptoapi mode+queue) that reads and writes the freddie host
// config (host.fs.getConfig()/setConfig()). It is consumed by both the OS chat
// panel (docs/freddie-chat.js) and — once upstreamed — the freddie dashboard
// chat tab, so both chat entry points are equally configurable.
//
// thebird-owned (NOT vendored): refresh-design will not wipe this.

import { t, availableLocales, getLocale, setLocale } from './vendor/i18n.js';
import { createPolicyEngine, PolicyAction } from './policy.js';
import { createAuditLog } from './audit.js';
import { EXAMPLE_PLUGINS } from './lib/example-plugins.js';
import { el } from './lib/dom.js';

// Human-readable names for the locale <select> — keyed by locale code so a
// new registerLocale() in vendor/i18n.js just needs an entry here to show up with a
// proper label instead of falling back to the bare code.
const LOCALE_NAMES = { en: 'English', es: 'Español' };

// Function, not a module-level const: every other t() call site in this file
// is inside a render function and re-evaluates on each render, so this must
// match — a frozen array would keep showing stale-locale labels forever if
// this strip is ever re-rendered in place after setLocale() without a full
// page reload (today's locale <select> onchange always reloads, but that is
// this function's caller's contract to keep, not this file's to assume).
function acptoapiModes() {
  return [
    { value: 'hybrid', label: t('chatConfig.modeHybrid', 'Internal -> External (default)') },
    { value: 'internal', label: t('chatConfig.modeInternal', 'Internal only (in-page keys)') },
    { value: 'external', label: t('chatConfig.modeExternal', 'External only (gateway server)') },
  ];
}

const DEFAULT_BASE_URL = 'http://localhost:4800';

// Reject a user-supplied gateway baseUrl whose origin differs from the page's
// own origin, unless it targets a local dev gateway (localhost/127.0.0.1/::1,
// any port). Prevents a malicious `?backend=`/config-injected baseUrl from
// redirecting API calls (and any credentials attached to them) to an
// attacker-controlled origin. Returns true when `raw` is safe to persist.
function isSameOriginOrLocalBaseUrl(raw) {
  let u;
  try { u = new URL(raw, location.href); } catch { return false; }
  const h = (u.hostname || '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  try { return u.origin === location.origin; } catch { return false; }
}

// Read the acptoapi config block with sane defaults.
export function getAcptoapiConfig(fs) {
  const cfg = (fs && fs.getConfig && fs.getConfig()) || {};
  const a = cfg.acptoapi || {};
  return {
    mode: a.mode || 'hybrid',
    baseUrl: a.baseUrl || DEFAULT_BASE_URL,
    queue: a.queue || '',
    internalQueue: Array.isArray(a.internalQueue) ? a.internalQueue : [],
  };
}

function persist(fs, mutate) {
  if (!fs || !fs.getConfig || !fs.setConfig) return;
  const cfg = fs.getConfig() || {};
  mutate(cfg);
  fs.setConfig(cfg);
  if (fs.flush) {
    // swallow: fs.flush is best-effort IDB flush — config was already set in-memory above
    fs.flush().catch(() => {});
  }
}

function setDeep(cfg, path, value) {
  const segs = path.split('.');
  let cur = cfg;
  for (let i = 0; i < segs.length - 1; i++) { cur[segs[i]] = cur[segs[i]] || {}; cur = cur[segs[i]]; }
  if (value == null || value === '') delete cur[segs[segs.length - 1]];
  else cur[segs[segs.length - 1]] = value;
}

function getDeep(cfg, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg);
}

function field(labelText, control) {
  return el('label', { class: 'cc-field' }, el('span', { class: 'cc-field-label' }, labelText), control);
}

// Agent descriptor shape surfaced by listAgentDescriptors(). This is a listing
// contract only -- it names what is really selectable through the dropdown
// today, it does NOT introduce a new multi-agent orchestration system.
//
// @typedef {Object} AgentDescriptor
// @property {string} id            - stable value used for agent.id persistence
// @property {string} label         - human-readable dropdown text
// @property {'internal'|'external'} protocol - which acptoapi mode this descriptor applies to
// @property {string[]} capabilities - coarse capability tags, e.g. ['chat','tools']

// List selectable agent descriptors for the current acptoapi mode.
//
// - 'internal' mode: freddie-host.js's `pi.agents()` (see docs/freddie-host.js
//   ~L731) returns SESSION ACTIVITY STATS (count/active/turns/last_activity
//   derived from `sessions.list()`), not a registry of multiple agents.
//   freddie has exactly one agent identity in-page today, so this branch is
//   honest about that: it always returns the single 'default' descriptor.
// - 'external' mode: acptoapi-browser.js's `listAllQueues(queues)` (see
//   docs/lib/acptoapi-browser.js ~L631) maps a `{name: models[]}` object to
//   `{name, models}` entries -- but the browser side never carries a static
//   `queues.json`; the only real, in-page list of named routing chains is the
//   `internalQueue` persisted by this same UI (config `acptoapi.internalQueue`,
//   see the internalQueueInput handler above) plus whatever named `queue/*`
//   ids the live `/v1/models` probe discovers on the reachable gateway
//   (`probeModelsAndQueues()` below). In this codebase a named queue IS the
//   closest real "agent" concept in external mode -- it is a fixed, ordered
//   model-routing chain a session is pinned to -- so each real queue name
//   becomes one descriptor, plus the always-present 'default'/auto entry.
async function listAgentDescriptors(mode, acptoapi) {
  if (mode !== 'external') {
    return [{ id: 'default', label: t('chatConfig.optionDefault', 'Default'), protocol: 'internal', capabilities: ['chat', 'tools'] }];
  }
  const out = [{ id: 'default', label: t('chatConfig.optionDefault', 'Default'), protocol: 'external', capabilities: ['chat', 'tools'] }];
  const seen = new Set(['default']);
  const acp = acptoapi || {};
  // Persisted internal-queue ordering, if the user configured one (acts as a
  // named routing chain even while mode === 'external').
  if (Array.isArray(acp.internalQueue) && acp.internalQueue.length) {
    const id = 'queue:configured';
    if (!seen.has(id)) { seen.add(id); out.push({ id, label: t('chatConfig.agentConfiguredQueue', 'Configured queue (') + acp.internalQueue.join(', ') + ')', protocol: 'external', capabilities: ['chat', 'tools'] }); }
  }
  // Live-discovered named queues from the reachable gateway's /v1/models.
  try {
    const probe = await probeModelsAndQueues(acp.baseUrl || DEFAULT_BASE_URL);
    for (const q of probe.queues) {
      const id = 'queue/' + q;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label: t('chatConfig.agentQueueLabel', 'Queue: ') + q, protocol: 'external', capabilities: ['chat', 'tools'] });
    }
  } catch { /* gateway unreachable — descriptors fall back to default/configured only */ }
  return out;
}

// Reachability-probe timeout. A bare unbounded fetch() left the status pill
// stuck on 'idle' forever whenever the daemon accepted the TCP connection but
// never answered (half-open socket, an unrelated process squatting on the
// port, a stalled acptoapi process) — that hang looked identical to "still
// checking" with no path to the accurate 'unreachable' verdict. 5s mirrors
// the same fast-fail intent as the documented AbortController(8s) loopback
// pattern elsewhere in the stack (freddie-host/acptoapi-browser) without
// stacking onto the acptoapi call's own timeouts.
const PROBE_TIMEOUT_MS = 5000;

// `outerSignal` (optional) lets a caller cancel this probe from outside —
// used by refresh() to abort a superseded generation's in-flight fetch
// immediately instead of letting it run to completion in the background.
async function fetchWithProbeTimeout(url, opts, outerSignal) {
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(new Error('probe timeout after ' + PROBE_TIMEOUT_MS + 'ms')), PROBE_TIMEOUT_MS);
  const onOuterAbort = () => ac.abort(outerSignal.reason || new Error('probe superseded'));
  if (outerSignal) {
    if (outerSignal.aborted) onOuterAbort();
    else outerSignal.addEventListener('abort', onOuterAbort);
  }
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally {
    clearTimeout(tid);
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
  }
}

// Probe a list of models/queues from acptoapi (external) when reachable.
//
// `out.reason` carries WHY reachable is false — distinct failure classes
// (timeout / network error / non-2xx status) previously collapsed into a
// single silent catch, so a user staring at "gateway unreachable" had no way
// to tell "no daemon booted" (the expected, correct case — see
// docs/acptoapi-integration.md) apart from a real bug in the probe itself
// (wrong baseUrl, CORS/private-network-access rejection, daemon up but wedged).
// The status pill's tooltip (createChatConfig's `refresh()`) surfaces this.
async function probeModelsAndQueues(baseUrl, signal) {
  const out = { models: [], queues: [], reachable: false, cacheStats: null, reason: null };
  const base = baseUrl.replace(/\/+$/, '');
  try {
    const r = await fetchWithProbeTimeout(base + '/v1/models', { method: 'GET' }, signal);
    if (r.ok) {
      out.reachable = true;
      const j = await r.json();
      const data = Array.isArray(j.data) ? j.data : [];
      for (const m of data) {
        const id = m.id || m.model || '';
        if (!id) continue;
        if (id.startsWith('queue/')) out.queues.push(id.slice('queue/'.length));
        else out.models.push(id);
      }
    } else {
      out.reason = 'HTTP ' + r.status + ' ' + (r.statusText || '');
    }
  } catch (e) {
    // AbortError from fetchWithProbeTimeout's own controller reads as a plain
    // "aborted" DOMException with no useful message — report it as a timeout
    // explicitly rather than the generic network-error text.
    out.reason = (e && e.name === 'AbortError') ? ('timed out after ' + PROBE_TIMEOUT_MS + 'ms — daemon may be up but not responding') : ((e && e.message) || String(e));
  }
  if (out.reachable) {
    try {
      const cr = await fetchWithProbeTimeout(base + '/v1/cache/stats', { method: 'GET' }, signal);
      if (cr.ok) out.cacheStats = await cr.json();
    } catch { /* cache stats endpoint absent on older acptoapi — non-fatal */ }
  }
  return out;
}

// Build the config strip. Returns { node, refresh } where node is a DOM element
// to mount above a chat composer, and refresh re-reads host-derived options.
// All visual styles live upstream in anentrypoint-design/src/kits/os/theme.css
// under the .ds-247420 .cc-* / .freddie-chat-wrap selectors (zero-design-CSS-in-thebird rule).

export function createChatConfig({ instance, getHost, onChange, pluginHost } = {}) {
  const fs = instance && instance.fs;
  const root = el('div', { class: 'cc-strip', 'data-chat-config': instance ? instance.id : '?' });

  const toggle = el('button', { class: 'cc-toggle', type: 'button', title: t('chatConfig.toggleTitle', 'chat configuration') }, t('chatConfig.toggleLabel', 'config'));
  const body = el('div', { class: 'cc-body', hidden: '' });
  let open = false;
  toggle.addEventListener('click', () => { open = !open; if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', ''); toggle.classList.toggle('cc-open', open); });
  root.append(toggle, body);

  const status = el('span', { class: 'cc-acp-status', title: t('chatConfig.statusTitle', 'gateway reachability') }, t('chatConfig.statusIdle', 'idle'));

  // --- selectors (populated in refresh) ---
  const modelSel = el('select', { class: 'cc-model', onchange: (e) => { persist(fs, c => setDeep(c, 'agent.model', e.target.value)); onChange && onChange('model', e.target.value); } });
  const agentSel = el('select', { class: 'cc-agent', onchange: (e) => { persist(fs, c => setDeep(c, 'agent.id', e.target.value)); onChange && onChange('agent', e.target.value); } });
  // Seed synchronous defaults so the selects are never empty even before the
  // async acptoapi/host probe resolves (empty-state when acptoapi is down).
  modelSel.append(el('option', { value: 'auto' }, t('chatConfig.optionAuto', 'auto')));
  agentSel.append(el('option', { value: 'default' }, t('chatConfig.optionDefault', 'default')));
  const cwdInput = el('input', { class: 'cc-cwd', type: 'text', placeholder: t('chatConfig.cwdPlaceholder', '/ (IDB filesystem root)') });
  cwdInput.addEventListener('input', (e) => { persist(fs, c => setDeep(c, 'agent.cwd', e.target.value)); onChange && onChange('cwd', e.target.value); });
  const skillsBox = el('div', { class: 'cc-skills' });
  const pluginsBox = el('div', { class: 'cc-plugins' });
  const policyBox = el('div', { class: 'cc-policy' });
  // Lazily-constructed policy engine, same instance.fs-backed pattern as
  // audit.js/policy.js expect. Guarded because instance.fs may be absent
  // (e.g. host-less test construction) -- policyEngine stays null then and
  // the section just shows "(unavailable)".
  let policyEngine = null;
  if (fs) {
    try {
      const auditLog = createAuditLog(instance);
      policyEngine = createPolicyEngine(instance, auditLog, { defaultDeny: false });
    } catch { policyEngine = null; }
  }

  const modeSel = el('select', { class: 'cc-acp-mode', onchange: (e) => { persist(fs, c => setDeep(c, 'acptoapi.mode', e.target.value)); onChange && onChange('acptoapi-mode', e.target.value); } },
    ...acptoapiModes().map(m => el('option', { value: m.value }, m.label)));
  const baseUrlInput = el('input', { class: 'cc-acp-url', type: 'text', placeholder: DEFAULT_BASE_URL });
  baseUrlInput.addEventListener('change', (e) => {
    const raw = e.target.value || DEFAULT_BASE_URL;
    try { new URL(raw); } catch {
      status.textContent = t('chatConfig.statusInvalidUrl', 'invalid URL');
      status.title = t('chatConfig.statusInvalidUrlTitle', 'Invalid gateway URL: ') + raw;
      status.classList.remove('cc-reachable');
      return;
    }
    if (!isSameOriginOrLocalBaseUrl(raw)) {
      const prior = getAcptoapiConfig(fs).baseUrl;
      console.warn('[chat-config] rejected cross-origin gateway baseUrl:', raw, '(keeping', prior + ')');
      status.textContent = t('chatConfig.statusCrossOriginUrl', 'cross-origin URL rejected');
      status.title = t('chatConfig.statusCrossOriginUrlTitle', 'Gateway URL must be same-origin or localhost: ') + raw;
      status.classList.remove('cc-reachable');
      baseUrlInput.value = prior;
      return;
    }
    persist(fs, c => setDeep(c, 'acptoapi.baseUrl', raw)); refresh(); onChange && onChange('acptoapi-baseUrl', raw);
  });
  const queueSel = el('select', { class: 'cc-acp-queue', onchange: (e) => { persist(fs, c => setDeep(c, 'acptoapi.queue', e.target.value)); onChange && onChange('acptoapi-queue', e.target.value); } });

  // Locale switcher: t() reads the active locale synchronously on every call
  // (docs/vendor/i18n.js getLocale()), but most labels in this module (and every
  // other app) are computed once at construction time, so a locale change
  // needs a reload to actually re-render every already-built t() string —
  // simplest correct behavior for a primitive with no reactive re-render
  // hook, rather than half-translating only the strings this module happens
  // to re-evaluate on refresh().
  const localeSel = el('select', {
    class: 'cc-locale',
    onchange: (e) => { setLocale(e.target.value); onChange && onChange('locale', e.target.value); if (typeof location !== 'undefined') location.reload(); },
  }, ...availableLocales().map(code => el('option', { value: code, selected: code === getLocale() ? '' : undefined }, LOCALE_NAMES[code] || code)));

  // internal queue editor: comma-separated ordered model list
  const internalQueueInput = el('input', { class: 'cc-internal-queue', type: 'text', placeholder: t('chatConfig.internalQueuePlaceholder', 'auto  (or: groq/llama-3.3-70b-versatile, cerebras/llama-3.3-70b)') });
  internalQueueInput.addEventListener('change', (e) => {
    const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    persist(fs, c => setDeep(c, 'acptoapi.internalQueue', arr.length ? arr : null));
    onChange && onChange('acptoapi-internalQueue', arr);
  });

  body.append(
    el('div', { class: 'cc-row' },
      field(t('chatConfig.fieldModel', 'model'), modelSel),
      field(t('chatConfig.fieldAgent', 'agent'), agentSel)),
    field(t('chatConfig.fieldWorkingFolder', 'working folder'), cwdInput),
    el('div', { class: 'cc-row' },
      field(t('chatConfig.fieldGateway', 'gateway'), el('span', { class: 'cc-acp-mode-wrap' }, modeSel, status)),
      field(t('chatConfig.fieldQueue', 'queue'), queueSel)),
    field(t('chatConfig.fieldExternalBaseUrl', 'external base url'), baseUrlInput),
    field(t('chatConfig.fieldInternalQueue', 'internal queue (ordered, comma-separated)'), internalQueueInput),
    field(t('chatConfig.fieldLanguage', 'language'), localeSel),
    el('details', { class: 'cc-details' }, el('summary', {}, t('chatConfig.detailsSkills', 'skills')), skillsBox),
    el('details', { class: 'cc-details' }, el('summary', {}, t('chatConfig.detailsPlugins', 'plugins')), pluginsBox),
    el('details', { class: 'cc-details' }, el('summary', {}, t('chatConfig.detailsPolicy', 'policy')), policyBox),
  );

  function renderPolicy() {
    policyBox.textContent = '';
    if (!policyEngine) { policyBox.append(el('div', { class: 'cc-empty' }, t('chatConfig.policyUnavailable', '(unavailable)'))); return; }
    const rules = policyEngine.getRules();
    const list = el('ul', { class: 'cc-policy-list' });
    if (!rules.length) {
      list.append(el('li', { class: 'cc-empty' }, t('chatConfig.noneAvailable', '(none available)')));
    } else {
      rules.forEach((r, i) => {
        const removeBtn = el('button', { class: 'cc-policy-remove', type: 'button', title: t('chatConfig.policyRemove', 'remove rule') }, '×');
        removeBtn.addEventListener('click', () => {
          const next = rules.slice(); next.splice(i, 1);
          policyEngine.setRules(next);
          renderPolicy();
        });
        list.append(el('li', {},
          el('span', { class: 'cc-policy-rule' }, r.action + ': ' + r.pattern + ' -> ' + (r.allow ? 'allow' : 'deny')),
          removeBtn));
      });
    }
    policyBox.append(list);

    const actionSel = el('select', { class: 'cc-policy-action' },
      ...Object.values(PolicyAction).map(a => el('option', { value: a }, a)));
    const patternInput = el('input', { class: 'cc-policy-pattern', type: 'text', placeholder: t('chatConfig.policyPatternPlaceholder', 'glob pattern, e.g. /etc/**') });
    const allowSel = el('select', { class: 'cc-policy-allow' },
      el('option', { value: 'deny' }, t('chatConfig.policyDeny', 'deny')),
      el('option', { value: 'allow' }, t('chatConfig.policyAllow', 'allow')));
    const addBtn = el('button', { class: 'cc-policy-add', type: 'button' }, t('chatConfig.policyAdd', 'add'));
    addBtn.addEventListener('click', () => {
      const pattern = patternInput.value.trim();
      if (!pattern) return;
      const rule = { action: actionSel.value, pattern, allow: allowSel.value === 'allow' };
      policyEngine.setRules([...policyEngine.getRules(), rule]);
      patternInput.value = '';
      renderPolicy();
      onChange && onChange('policy-rules', policyEngine.getRules());
    });
    policyBox.append(el('div', { class: 'cc-row' }, actionSel, patternInput, allowSel, addBtn));
  }

  function optionList(sel, values, current, { autoFirst = false } = {}) {
    sel.textContent = '';
    if (autoFirst) sel.append(el('option', { value: 'auto' }, 'auto'));
    for (const v of values) {
      const o = el('option', { value: v }, v);
      if (v === current) o.selected = true;
      sel.append(o);
    }
    if (current && !values.includes(current) && current !== 'auto') {
      const o = el('option', { value: current }, current + t('chatConfig.customSuffix', ' (custom)')); o.selected = true; sel.append(o);
    } else if (autoFirst && (!current || current === 'auto')) {
      sel.value = 'auto';
    }
  }

  function checkboxList(box, items, enabledSet, key) {
    box.textContent = '';
    if (!items.length) { box.append(el('div', { class: 'cc-empty' }, t('chatConfig.noneAvailable', '(none available)'))); return; }
    for (const name of items) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = enabledSet.has(name);
      cb.addEventListener('change', () => {
        const cfg = (fs && fs.getConfig && fs.getConfig()) || {};
        const cur = new Set(Array.isArray(getDeep(cfg, key)) ? getDeep(cfg, key) : []);
        if (cb.checked) cur.add(name); else cur.delete(name);
        persist(fs, c => setDeep(c, key, [...cur]));
        // 'plugins.enabled' has a real backing contract (docs/lib/plugin.js
        // createPluginHost): toggling the checkbox actually registers/tears
        // down the plugin, not just persists a cosmetic list.
        if (key === 'plugins.enabled' && pluginHost) {
          const plugin = EXAMPLE_PLUGINS[name];
          if (plugin) {
            if (cb.checked) pluginHost.use(plugin);
            else pluginHost.unregister(name);
          }
        }
        onChange && onChange(key, [...cur]);
      });
      box.append(el('label', { class: 'cc-check' }, cb, el('span', {}, name)));
    }
  }

  let refreshGen = 0;
  // Abort controller for the currently in-flight probe, so a new refresh()
  // call cancels the previous generation's fetch immediately instead of
  // letting it run to completion (up to 2x PROBE_TIMEOUT_MS) in the
  // background before its stale-response guard silently discards the result.
  let refreshAbort = null;
  async function refresh() {
    if (refreshAbort) refreshAbort.abort(new Error('superseded by newer refresh()'));
    const myAbort = new AbortController();
    refreshAbort = myAbort;
    const myGen = ++refreshGen;
    const cfg = (fs && fs.getConfig && fs.getConfig()) || {};
    const host = getHost && getHost();
    const acp = getAcptoapiConfig(fs);

    modeSel.value = acp.mode;
    baseUrlInput.value = acp.baseUrl;
    internalQueueInput.value = acp.internalQueue.join(', ');
    cwdInput.value = getDeep(cfg, 'agent.cwd') || '';

    // acptoapi probe (external models + queues + reachability)
    const probe = await probeModelsAndQueues(acp.baseUrl, myAbort.signal);
    // Stale-response guard: a newer refresh() may have started (and possibly
    // already finished) while this one's probe was in flight. If so, this
    // call's DOM writes would clobber fresher data with a response for an
    // old baseUrl -- bail out silently.
    if (myGen !== refreshGen) return;
    // Re-read cfg after the probe await: same-generation refresh() must still
    // reflect whatever the user most recently persisted (model/agent/cwd
    // dropdown change) while the probe was in flight, not the stale snapshot
    // captured before the await -- otherwise the rebuild below silently
    // reverts a live mid-probe edit back to its pre-probe value.
    const cfgNow = (fs && fs.getConfig && fs.getConfig()) || cfg;
    // Re-derive acp from cfgNow too: mode/baseUrl/queue may have changed
    // (e.g. a programmatic config write from elsewhere, not just this
    // input's own onchange) while the probe was in flight -- status text
    // and the agent-descriptor probe below must reflect the live config,
    // not the pre-await snapshot captured before the await.
    const acpNow = getAcptoapiConfig(fs) || acp;
    status.textContent = probe.reachable ? t('chatConfig.statusLive', 'live') : t('chatConfig.statusIdle', 'idle');
    let statusTitle = probe.reachable ? (t('chatConfig.statusReachable', 'gateway reachable at ') + acpNow.baseUrl) : (t('chatConfig.statusUnreachable', 'gateway unreachable at ') + acpNow.baseUrl + t('chatConfig.statusUnreachableSuffix', ' — using internal/fallback'));
    // Surface WHY the probe failed (timeout / HTTP status / network error) so
    // "no daemon running" (expected, see acptoapi-integration.md) is visibly
    // distinct from a broken probe (wrong baseUrl, CORS/PNA rejection, daemon
    // up but wedged) instead of both collapsing into the same opaque pill.
    if (!probe.reachable && probe.reason) statusTitle += ' (' + probe.reason + ')';
    if (probe.reachable && probe.cacheStats) {
      const cs = probe.cacheStats;
      const hits = cs.hits ?? cs.hit ?? 0;
      const misses = cs.misses ?? cs.miss ?? 0;
      const total = hits + misses;
      if (total > 0) statusTitle += t('chatConfig.statusCacheSuffix', ' — cache ') + hits + '/' + total + ' hits';
    }
    status.title = statusTitle;
    status.classList.toggle('cc-reachable', probe.reachable);

    const models = probe.models.length ? probe.models : [];
    optionList(modelSel, models, getDeep(cfgNow, 'agent.model') || 'auto', { autoFirst: true });
    optionList(queueSel, ['', ...probe.queues], acpNow.queue);
    // first queue option is the "no queue" empty
    if (queueSel.options.length) { queueSel.options[0].textContent = t('chatConfig.optionNoQueue', '— no queue —'); }

    // agents: descriptor-backed listing (listAgentDescriptors) -- honest about
    // the current 1-agent internal reality, external mode surfaces real named
    // queues as agent-routing-target descriptors. Session-active id (if any,
    // from host.pi.agents()) is appended as an extra selectable descriptor
    // when it differs, so an in-flight session id is never hidden.
    let descriptors = await listAgentDescriptors(acpNow.mode, acpNow);
    if (myGen !== refreshGen) return;
    try {
      if (host && host.pi && host.pi.agents) {
        const a = await host.pi.agents();
        if (a && a.active && !descriptors.some(d => d.id === a.active)) {
          descriptors = [...descriptors, { id: a.active, label: t('chatConfig.agentActiveSession', 'Active session (') + a.active + ')', protocol: acpNow.mode === 'external' ? 'external' : 'internal', capabilities: ['chat', 'tools'] }];
        }
      }
    } catch {
      // swallow: host.pi.agents() probe failed — descriptors list falls back to the static/queue-derived set
    }
    agentSel.textContent = '';
    const currentAgentId = getDeep(cfgNow, 'agent.id') || 'default';
    for (const d of descriptors) {
      const o = el('option', { value: d.id }, d.label);
      if (d.id === currentAgentId) o.selected = true;
      agentSel.append(o);
    }
    if (currentAgentId && !descriptors.some(d => d.id === currentAgentId)) {
      const o = el('option', { value: currentAgentId }, currentAgentId + t('chatConfig.customSuffix', ' (custom)')); o.selected = true; agentSel.append(o);
    }

    // skills + plugins from host
    const skills = host && host.pi && host.pi.skills ? [...host.pi.skills.keys()].sort() : [];
    const enabledSkills = new Set(Array.isArray(getDeep(cfgNow, 'skills.enabled')) ? getDeep(cfgNow, 'skills.enabled') : skills);
    checkboxList(skillsBox, skills, enabledSkills, 'skills.enabled');

    // Populate from the host's command/plugin registry when present. The list
    // may be a Map (use keys), an array, or a function returning either.
    let plugins = [];
    try {
        const cmds = host && host.pi && host.pi.commands && host.pi.commands.list;
        const raw = typeof cmds === 'function' ? cmds() : cmds;
        if (raw instanceof Map) plugins = [...raw.keys()];
        else if (Array.isArray(raw)) plugins = raw.map(p => (p && p.name) ? p.name : String(p));
        else if (raw && typeof raw === 'object') plugins = Object.keys(raw);
        plugins = [...new Set(plugins)].sort();
    } catch {
        // swallow: host command/plugin registry shape unexpected or unreadable — plugins list falls back to empty
    }
    // Always surface the example plugin so the checkbox->createPluginHost
    // wiring is reachable even when the host has no real plugin/command
    // registry of its own yet.
    if (pluginHost && !plugins.includes('chat-config-example')) plugins.push('chat-config-example');
    const installed = Array.isArray(cfgNow.plugins && cfgNow.plugins.installed) ? cfgNow.plugins.installed : plugins;
    const enabledPlugins = new Set(Array.isArray(getDeep(cfgNow, 'plugins.enabled')) ? getDeep(cfgNow, 'plugins.enabled') : installed);
    checkboxList(pluginsBox, installed, enabledPlugins, 'plugins.enabled');

    renderPolicy();
  }

  refresh();
  return { node: root, refresh };
}
