import { createFxTerminal } from './vendor/fx/wasm-terminal.js';
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

export async function runFxTui(term, fx = {}) {
  const app = await createFxTerminal({
    terminal: xtermAdapter(term),
    wasm: WASM_URL,
    apiKey: fx.apiKey,
    model: fx.model,
    gatewayChatUrl: fx.gatewayChatUrl,
    oauthSessionStore: memoryOauthSessionStore(),
    promptHistoryStore: memoryPromptHistoryStore(),
  });
  app.interactive.catch(() => {});
  try {
    return await app.exited;
  } finally {
    app.abort();
  }
}
