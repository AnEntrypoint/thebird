import { runTjs } from './txiki-in-page.js';
import { applyFeatureRequest } from './features-bridge.js';

const PROGRAM_URL = new URL('./features-program.js', import.meta.url).href;

const bridge = async (name, argv) => {
  if (name === 'feature') return applyFeatureRequest(JSON.parse(argv[0]));
  if (name === 'webserver') { const [method, ...rest] = argv; const sdk = globalThis.THEBIRD_WEBSERVERS; if (!sdk) throw new Error('webserver sdk is not mounted'); if (method === 'mcp') return sdk.mcp(rest[0], rest[1], JSON.parse(rest[2] ?? '{}')); if (method === 'progress') return sdk.progress(JSON.parse(rest[0])); if (method === 'registry') return sdk.registry(); if (method === 'craft') { const craft = globalThis.THEBIRD_CRAFT; if (!craft) throw new Error('craft workspace is not mounted'); const [op, ...args] = rest; if (op === 'apps') return craft.apps(); if (op === 'intent') return craft.intent(args[0]); if (op === 'task') return craft.task(args[0], args[1], args[2]); if (op === 'open') return craft.open(args[0], args[1]); if (op === 'call') return craft.call(args[0], args[1], JSON.parse(args[2] ?? '{}')); throw new Error('unknown craft method ' + op); } throw new Error('unknown webserver method ' + method); }
  throw new Error(`unknown builtin: ${name}`);
};

export async function runFeatureProgram() {
  const response = await fetch(PROGRAM_URL);
  if (!response.ok) throw new Error(`features-program.js returned ${response.status}`);
  const source = `globalThis.__thebirdModuleUrl = ${JSON.stringify(PROGRAM_URL)};\n${await response.text()}`;
  const { output, status } = await runTjs(source, '/workspace', { builtin: bridge, name: 'features-program.js' });
  if (status !== 0) throw new Error(`feature program exited ${status}: ${output}`);
  return output.trim();
}

globalThis.THEBIRD_RUN_FEATURE_PROGRAM = runFeatureProgram;
