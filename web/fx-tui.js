import { createFxTerminal } from './vendor/fx/wasm-terminal.js';
import { GhosttyScreen, ghosttyAdapter, loadGhosttyVt } from './ghostty-screen.js';
import { DEFAULT_MODEL, providerFetch, providerOf, providerRegistry } from './fx-provider.js';

const WASM_URL = new URL('./vendor/fx/fx-term.wasm', import.meta.url).href;
const GHOSTTY_URL = new URL('./vendor/ghostty/ghostty-vt.wasm', import.meta.url).href;
const REVISION_CONFLICT = Object.assign(new Error('fx session revision conflict'), { code: 'FX_OAUTH_SESSION_REVISION_CONFLICT' });

const tuiStatus = { state: 'idle', model: null, exitCode: null, cols: null, rows: null, updatedAt: null };
const tuiListeners = new Set();

const publishTuiStatus = (patch) => {
  Object.assign(tuiStatus, patch, { updatedAt: new Date().toISOString() });
  const snapshot = { ...tuiStatus };
  for (const listener of tuiListeners) listener(snapshot);
};

export const fxTuiStatus = () => ({ ...tuiStatus });

export const onFxTuiStatus = (listener) => {
  tuiListeners.add(listener);
  return () => tuiListeners.delete(listener);
};

const onTuiEvent = (event) => {
  if (event.type === 'runtime.ready') publishTuiStatus({ state: 'running' });
  else if (event.type === 'runtime.exit') publishTuiStatus({ exitCode: event.code });
  else if (event.type === 'terminal.resize') publishTuiStatus({ cols: event.cols, rows: event.rows });
};

const memoryOauthSessionStore = () => {
  let record = null;
  let counter = 0;
  return {
    load: () => record,
    commit(bytes, expected) {
      if (expected !== undefined && expected !== record?.revision) throw REVISION_CONFLICT;
      counter++;
      record = { bytes, revision: String(counter) };
      return { revision: record.revision };
    },
    remove(expected) {
      if (expected !== undefined && expected !== record?.revision) throw REVISION_CONFLICT;
      const existed = record !== null;
      record = null;
      return existed;
    },
  };
};

const memoryPromptHistoryStore = () => {
  const histories = new Map();
  const entriesFor = (workspaceRoot) => {
    if (!histories.has(workspaceRoot)) histories.set(workspaceRoot, []);
    return histories.get(workspaceRoot);
  };
  return {
    load: (workspaceRoot, limit) => (limit > 0 ? entriesFor(workspaceRoot).slice(-limit) : []),
    append(workspaceRoot, value) {
      const entries = entriesFor(workspaceRoot);
      if (entries.at(-1) === value) return 'duplicate';
      entries.push(value);
      return 'stored';
    },
    clear(workspaceRoot) {
      histories.delete(workspaceRoot);
    },
  };
};

const gatewayEnvironment = (fx) => ({
  ...(fx.apiKey === undefined ? {} : { AI_GATEWAY_API_KEY: fx.apiKey }),
  ...(fx.model === undefined ? {} : { FX_MODEL: fx.model }),
  ...(fx.permissionMode === undefined ? {} : { FX_PERMISSION_MODE: fx.permissionMode }),
  ...(fx.gatewayChatUrl === undefined ? {} : { FX_GATEWAY_CHAT_URL: fx.gatewayChatUrl }),
});

const providerEnvironment = (fx, provider) => ({
  FX_CONFIGURED_PROVIDERS: providerRegistry(provider),
  FX_PROVIDER: provider.name,
  FX_MODEL: fx.model ?? DEFAULT_MODEL,
  ...(fx.permissionMode === undefined ? {} : { FX_PERMISSION_MODE: fx.permissionMode }),
});

export async function runFxTui(term, fx = {}, host = {}) {
  const screen = new GhosttyScreen(await loadGhosttyVt(GHOSTTY_URL), term.cols, term.rows);
  term.write("\x1b[?1049h");
  const provider = providerOf(fx);
  publishTuiStatus({ model: fx.model ?? (provider ? DEFAULT_MODEL : null), cols: term.cols, rows: term.rows, exitCode: null });
  const app = await createFxTerminal({
    terminal: ghosttyAdapter(term, screen),
    wasm: WASM_URL,
    env: provider ? providerEnvironment(fx, provider) : gatewayEnvironment(fx),
    ...(provider ? { fetch: providerFetch(provider, fx.apiKey) } : {}),
    oauthSessionStore: memoryOauthSessionStore(),
    promptHistoryStore: memoryPromptHistoryStore(),
    ...(host.tools === undefined ? {} : { tools: host.tools }),
    ...(host.hostToolExecutor === undefined ? {} : { hostToolExecutor: host.hostToolExecutor }),
    onEvent: onTuiEvent,
  });
  app.interactive.catch(() => {});
  try {
    return await app.exited;
  } finally {
    app.abort();
    screen.free();
    term.write("\x1b[?1049l");
    publishTuiStatus({ state: 'idle' });
  }
}
