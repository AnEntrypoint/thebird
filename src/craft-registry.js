import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { registerServer, serverFolder, readRegistry, writeRegistry } from './webserver-registry.js';

export const CRAFT_CONFIG = '.thebird/craft-apps.json';
export const CRAFT_APPS = {
  gridcraft: {
    id: 'gridcraft', title: 'GridCraft', kind: 'sheet', extensions: ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv', '.ods'],
    binary: process.env.GRIDCRAFT_CLI ?? '/workspace/ac/gridcraft/gridcraft-0.13.0-linux-x86_64/bin/gridcraft-cli',
    tools: ['gridcraft.info', 'gridcraft.cat', 'gridcraft.eval', 'gridcraft.convert', 'gridcraft.render', 'gridcraft.open'],
  },
  wordcraft: {
    id: 'wordcraft', title: 'WordCraft', kind: 'doc', extensions: ['.docx', '.doc', '.odt', '.rtf', '.md', '.txt'],
    binary: process.env.WORDCRAFT_CLI ?? '/workspace/ac/wordcraft/wordcraft-0.12.0-linux-x86_64/bin/wordcraft-cli',
    tools: ['wordcraft.info', 'wordcraft.text', 'wordcraft.inspect', 'wordcraft.render', 'wordcraft.convert', 'wordcraft.open'],
  },
  pdfcraft: {
    id: 'pdfcraft', title: 'PDFCraft', kind: 'pdf', extensions: ['.pdf'],
    binary: process.env.PDFCRAFT_CLI ?? '/workspace/ac/pdfcraft/pdfcraft-0.15.0-linux-x86_64/bin/pdfcraft-cli',
    tools: ['pdfcraft.info', 'pdfcraft.text', 'pdfcraft.render', 'pdfcraft.check', 'pdfcraft.audit', 'pdfcraft.open'],
  },
};

export const appForFile = (file) => {
  const ext = extname(String(file ?? '')).toLowerCase();
  return Object.values(CRAFT_APPS).find((app) => app.extensions.includes(ext)) ?? null;
};
export const appForIntent = (text) => {
  const value = String(text ?? '').toLowerCase();
  if (/\b(sheet|spreadsheet|xlsx|csv|tsv|grid|cell|formula)\b/.test(value)) return CRAFT_APPS.gridcraft;
  if (/\b(doc|docx|odt|rtf|word|document|letter|manuscript)\b/.test(value)) return CRAFT_APPS.wordcraft;
  if (/\b(pdf|page|render|extract|combine|split)\b/.test(value) || /\.pdf\b/.test(value)) return CRAFT_APPS.pdfcraft;
  return appForFile(value);
};

export async function readCraftConfig(projectRoot = process.cwd()) {
  const path = resolve(projectRoot, CRAFT_CONFIG);
  const configured = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
  return Object.fromEntries(Object.entries(CRAFT_APPS).map(([id, app]) => [id, { ...app, binary: configured.apps?.[id]?.binary ?? app.binary }]));
}

export async function writeCraftConfig(projectRoot = process.cwd()) {
  const apps = await readCraftConfig(projectRoot);
  const path = resolve(projectRoot, CRAFT_CONFIG);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, apps: Object.fromEntries(Object.entries(apps).map(([id, app]) => [id, { binary: app.binary, kind: app.kind, extensions: app.extensions }])) }, null, 2) + '\n');
  return apps;
}

export async function ensureCraftApps(projectRoot = process.cwd()) {
  const apps = await writeCraftConfig(projectRoot);
  for (const app of Object.values(apps)) {
    await registerServer(projectRoot, app.id, { title: app.title, description: app.title + ' lazy native document adapter' });
    const folder = serverFolder(projectRoot, app.id);
    await mkdir(join(folder, 'documents'), { recursive: true });
    await mkdir(join(folder, 'public', 'previews'), { recursive: true });
    await writeFile(join(folder, 'craft.json'), JSON.stringify({ app: app.id, binary: app.binary, lazy: true }, null, 2) + '\n');
  }
  return apps;
}

const run = (binary, args, cwd) => new Promise((ok) => {
  const startedAt = Date.now();
  const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('error', (error) => ok({ code: 1, stdout, stderr: stderr + '\n' + error.message, pid: child.pid }));
  child.on('exit', (code) => ok({ code, stdout, stderr, pid: child.pid, ms: Date.now() - startedAt }));
});

export async function createSamples(projectRoot = process.cwd()) {
  const apps = await ensureCraftApps(projectRoot);
  const made = {};
  const grid = join(serverFolder(projectRoot, 'gridcraft'), 'documents');
  const gridCsv = join(grid, 'sample.csv');
  await writeFile(gridCsv, 'name,score\nalpha,7\nbeta,11\n');
  made.gridcraft = gridCsv;
  const word = join(serverFolder(projectRoot, 'wordcraft'), 'documents');
  const wordTxt = join(word, 'sample.txt');
  await writeFile(wordTxt, 'WordCraft sample document\nHello from thebird.\n');
  made.wordcraft = wordTxt;
  const pdf = join(serverFolder(projectRoot, 'pdfcraft'), 'documents');
  const pdfSource = join(pdf, 'sample.txt');
  await writeFile(pdfSource, 'PDFCraft sample document\nGenerated for thebird.\n');
  const converted = await run(apps.wordcraft.binary, ['convert', pdfSource, join(pdf, 'sample.pdf')], pdf);
  made.pdfcraft = existsSync(join(pdf, 'sample.pdf')) ? join(pdf, 'sample.pdf') : pdfSource;
  made.pdfcraftConversion = converted.code;
  return made;
}

export async function craftDescriptor(projectRoot, app) {
  return {
    version: 1, name: app.id, title: app.title, kind: app.kind, lazy: true, binary: app.binary,
    transport: 'thebird-node-cli-adapter', endpoint: '/__thebird/mcp/' + app.id,
    tools: app.tools.map((name) => ({ name, description: name.split('.')[1] + ' via native ' + app.title + ' CLI', input: { file: 'string', args: 'object' }, output: { type: 'object' } })),
    resources: [{ name: 'documents', uri: '/sites/' + app.id + '/documents' }, { name: 'previews', uri: '/sites/' + app.id + '/previews' }],
    prompts: [{ name: 'intent', text: 'Use ' + app.id + ' for ' + app.extensions.join(', ') + ' work' }],
  };
}

export async function callCraft(projectRoot, appId, method, params = {}) {
  const apps = await readCraftConfig(projectRoot);
  const app = apps[appId];
  if (!app) throw new Error('unknown craft app ' + appId);
  const folder = serverFolder(projectRoot, appId);
  const documents = join(folder, 'documents');
  const previews = join(folder, 'public', 'previews');
  const file = params.file ? resolve(documents, params.file.replace(/^.*[\\/]/, '')) : join(documents, await firstDocument(documents));
  const action = method.includes('.') ? method.split('.').pop() : method;
  let args = [];
  if (action === 'open' || action === 'info') args = app.kind === 'sheet' ? ['info', file, '--json'] : ['info', file];
  else if (action === 'cat') args = ['cat', file, '--csv'];
  else if (action === 'text') args = ['text', file];
  else if (action === 'inspect') args = ['inspect', file];
  else if (action === 'eval') args = ['eval', params.formula ?? '1+1', '--in', file, '--json'];
  else if (action === 'check') args = ['check', file];
  else if (action === 'audit') args = ['audit', file];
  else if (action === 'render') {
    const out = join(previews, app.kind + '-preview.png');
    args = app.kind === 'sheet' ? ['convert', file, out] : app.kind === 'doc' ? ['render', file, out] : ['render', file, '--page', String(params.page ?? 1), '--out', out];
  } else if (action === 'convert') {
    const out = join(previews, params.out ?? ('converted' + (params.ext ?? '.txt')));
    args = ['convert', file, out];
  } else if (action === 'run') args = ['run', ...(params.args ?? [])];
  else throw new Error('unknown craft method ' + method);
  const result = await run(app.binary, args, folder);
  const preview = existsSync(join(previews, app.kind + '-preview.png')) ? '/sites/' + appId + '/previews/' + app.kind + '-preview.png' : null;
  return { ok: result.code === 0, method, app: appId, file, pid: result.pid, code: result.code, ms: result.ms, stdout: result.stdout.slice(0, 8000), stderr: result.stderr.slice(0, 2000), preview };
}

async function firstDocument(folder) {
  const names = (await readdir(folder).catch(() => [])).sort();
  if (!names.length) throw new Error('no sample document; run node bin/thebird-craft.js sample');
  return names[0];
}

export async function craftStatus(projectRoot = process.cwd()) {
  const apps = await readCraftConfig(projectRoot);
  const registry = await readRegistry(projectRoot);
  return Object.values(apps).map((app) => ({ ...app, registered: registry.servers.some((entry) => entry.id === app.id), running: false, lazy: true }));
}

export async function craftRuntime(projectRoot = process.cwd()) {
  return { processes: [], lazy: true, reason: 'native CLI adapters spawn per task and exit' };
}
