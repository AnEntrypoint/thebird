import { createFxTerminal } from './vendor/fx/wasm-terminal.js';
import { initializeHostTools } from './fx-host-tools.js';
import { xtermAdapter } from './vendor/fx/xterm.js';

const WASM_URL = new URL('./vendor/fx/fx-term.wasm', import.meta.url).href;
const REVISION_CONFLICT = Object.assign(new Error('fx session revision conflict'), { code: 'FX_OAUTH_SESSION_REVISION_CONFLICT' });

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

const environmentFor = (fx) => ({
  ...(fx.apiKey === undefined ? {} : { AI_GATEWAY_API_KEY: fx.apiKey }),
  ...(fx.model === undefined ? {} : { FX_MODEL: fx.model }),
  ...(fx.permissionMode === undefined ? {} : { FX_PERMISSION_MODE: fx.permissionMode }),
  ...(fx.gatewayChatUrl === undefined ? {} : { FX_GATEWAY_CHAT_URL: fx.gatewayChatUrl }),
});

export async function runFxTui(term, fx = {}) {
  const app = await createFxTerminal({
    terminal: xtermAdapter(term),
    wasm: WASM_URL,
    env: environmentFor(fx),
    oauthSessionStore: memoryOauthSessionStore(),
    promptHistoryStore: memoryPromptHistoryStore(),
    beforeStart: initializeHostTools,
  });
  app.interactive.catch(() => {});
  try {
    return await app.exited;
  } finally {
    app.abort();
  }
}
