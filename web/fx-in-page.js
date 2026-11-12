import { createFxEngine, supportsJspi } from './vendor/fx/engine.js';
import { wasmRuntimeFactory } from './vendor/fx/wasm-runtime.js';
import { requestTakeover } from './takeover.js';
import { PAGE_HOST_TOOLS } from './fx-host-tools.js';
import { DEFAULT_MODEL, providerOf } from './fx-provider.js';

const WASM_URL = new URL('./vendor/fx/fx-core.wasm', import.meta.url).href;
const MANIFEST_URL = new URL('./vendor/fx/manifest.json', import.meta.url).href;
const USAGE = 'usage: fx | fx --version | fx --help | fx check | fx ask <prompt>';
const HELP = `${USAGE}\n\nfx runs libfx's WebAssembly core in this browser. Set window.THEBIRD_FX to { apiKey, model, gatewayChatUrl } before fx ask, or { apiKey, model, provider: { name, baseUrl, models } } for a custom OpenAI-compatible provider. The key stays in this page and is never written to the workspace.`;
let manifest = null;

const loadManifest = async () => {
  manifest ??= fetch(MANIFEST_URL).then((response) => {
    if (!response.ok) throw new Error('fx vendor manifest is missing: run node scripts/vendor-fx.mjs');
    return response.json();
  }).catch((error) => {
    manifest = null;
    throw error;
  });
  return manifest;
};

const config = () => {
  const value = globalThis.THEBIRD_FX;
  if (!value || typeof value !== 'object') throw new Error('fx ask needs window.THEBIRD_FX with apiKey and model');
  if (typeof value.apiKey !== 'string' || !value.apiKey) throw new Error('fx ask needs window.THEBIRD_FX.apiKey');
  return value;
};

const textOf = (turn) => (async () => {
  let text = '';
  for await (const event of turn) {
    if (event.type === 'text_delta') text += event.delta;
  }
  await turn.result;
  return text.trimEnd();
})();

const customEngine = ({ provider, apiKey }) => ({ provider, credentials: () => ({ apiKey }) });
const gatewayEngine = ({ apiKey, gatewayChatUrl }) => ({ apiKey, gatewayChatUrl });

const ask = async (argv, signal) => {
  const prompt = argv.join(' ').trim();
  if (!prompt) throw new Error(USAGE);
  if (!supportsJspi()) throw new Error('fx needs WebAssembly JSPI: open thebird in Chrome or Edge 137+');
  const options = config();
  const provider = providerOf(options);
  const engine = await createFxEngine({
    wasm: WASM_URL,
    ...(provider ? customEngine({ ...options, provider }) : gatewayEngine(options)),
    model: options.model ?? DEFAULT_MODEL,
    tools: PAGE_HOST_TOOLS,
  }, wasmRuntimeFactory());
  if (signal.aborted) {
    await engine.close().catch(() => {});
    throw new Error('cancelled');
  }
  const onAbort = () => engine.close().catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([
      textOf(engine.prompt(prompt)),
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })),
    ]);
  } catch (error) {
    if (signal.aborted || error?.message === 'cancelled') throw new Error('cancelled');
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    await engine.close().catch(() => {});
  }
};

export async function fxBuiltin(argv, { signal } = {}) {
  const [command, ...rest] = argv;
  if (argv.length === 0) {
    const code = await requestTakeover('fx', { fx: globalThis.THEBIRD_FX ?? {} });
    if (code !== 0) throw new Error(`fx exited with status ${code}`);
    return '';
  }
  if (command === '--version' || command === '-V' || command === 'version') {
    const info = await loadManifest();
    return `fx-core.wasm ${info.wasm.sha256.slice(0, 12)} libfx SDK ${info.sdkApiVersion}`;
  }
  if (command === '--help' || command === '-h' || command === 'help') return HELP;
  if (command === 'check') {
    await loadManifest();
    const wasm = await fetch(WASM_URL, { method: 'HEAD' }).catch(() => null);
    if (!wasm?.ok) throw new Error('fx-core.wasm is missing: run node scripts/vendor-fx.mjs');
    return `fx ready: JSPI ${supportsJspi() ? 'available' : 'missing'}; core ${wasm.headers.get('content-type') ?? 'unknown type'}`;
  }
  if (command === 'ask') return ask(rest, signal ?? new AbortController().signal);
  throw new Error(`fx: unknown command '${command}'\n${USAGE}`);
}
