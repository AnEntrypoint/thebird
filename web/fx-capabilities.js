export const THEBIRD_FX_CAPABILITIES = {
  version: 1,
  environment: 'normal computer',
  semantics: 'node/npm/bash files and processes; no sandbox language in prompts',
  shell: ['bash', 'sh', 'node', 'npm', 'npx', 'tjs', 'qjs', 'curl', 'wget', 'git', 'python3', 'pip', 'sqlite3', 'fx', 'feature', 'playwriter'],
  runtime: 'txiki.js wasm in the browser provides normal command-line execution for the page',
  filesystem: '/workspace and browser OPFS-backed shell workspace; edit files with shell commands',
  webservers: ['/__thebird/registry', '/__thebird/events', '/__thebird/progress', '/__thebird/mcp', '/sites/<id>/settings'],
  craft: ['gridcraft', 'wordcraft', 'pdfcraft'],
  browserApis: ['fetch', 'EventSource', 'window.THEBIRD_WEBSERVERS', 'window.THEBIRD_CRAFT', 'window.THEBIRD_FEATURES'],
  toolAvailability: 'bash and ask host tools are wired in-session to the live shell client and browser prompt',
};

export const THEBIRD_FX_SYSTEM_PROMPT = [
  'You are running inside thebird on a normal computer.',
  'Use bash, node, npm, npx, tjs, curl, wget, git, python3, pip, sqlite3 and normal files in /workspace.',
  'The browser host wires bash and ask tools live through the shell client; terminal tools are available.',
  'Never claim shell tools are missing, and never describe the environment as a crippled interpreter or sandbox.',
  'For hosted sites use node bin/thebird-webserver.js register <id>, then normal npm and bash commands in .thebird/webservers/<id>.',
  'For sheet/doc/PDF work use live MCP intent and tools: gridcraft, wordcraft, pdfcraft under /__thebird/mcp.',
  'Use fetch/EventSource and window.THEBIRD_WEBSERVERS, THEBIRD_CRAFT and THEBIRD_FEATURES for in-session live UI and HMR.',
].join(' ');

export function fxPromptFor(userPrompt) {
  return THEBIRD_FX_SYSTEM_PROMPT + '\n\nTask: ' + String(userPrompt ?? '').trim();
}

export function assertNoHostRefusal(text) {
  const value = String(text ?? '').toLowerCase();
  const banned = ['terminal tools are unavailable', 'javascript host', 'crippled js host', 'cannot inspect files', 'no exit code or shell output'];
  return banned.filter((phrase) => value.includes(phrase));
}
