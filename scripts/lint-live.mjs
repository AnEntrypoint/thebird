import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRelay } from '../src/relay.js';
import { runTerminal } from './browser-driver.mjs';

const chrome = process.env.CHROME_BIN ?? '/usr/bin/chromium-browser';
const COMMANDS = 'echo printf test seq sed awk grep sort uniq wc head tail cut tr find xargs tee ls cp mv rm mkdir touch cat basename dirname date env export type jq base64 md5sum sha256sum gzip gunzip sleep';
const TERMINAL_LIMIT_MS = 900000;

const PROBES = [
  ['pipe', String.raw`printf "a\nb\n" | sort -r | head -1`],
  ['quotes', String.raw`printf "%s|%s\n" "(x)" 'y z'`],
  ['head', 'seq 1 100000 | head -1'],
  ['sqlite', `sqlite3 lint.db "create table t(a,b); insert into t values (1,'two'); select a,b from t"`],
  ['node', 'node -v; echo rc=$?'],
  ['host', 'ruby -v; echo rc=$?'],
  ['tar', 'tar --version'],
  ['commands', `for n in ${COMMANDS}; do command -v "$n" >/dev/null || echo missing-$n; done; echo all-resolved`],
  ['type-t', 'type -t git'],
  ['type-fn', 'type which'],
  ['python-c', 'python3 -c "print(40+2)"'],
  ['curl-v', 'curl -v http://127.0.0.1:9/'],
  ['curl-SL', 'curl -SL http://127.0.0.1:9/'],
  ['amp', 'sleep 0 & echo x'],
];

const stamp = () => new Date().toISOString().slice(11, 23);
const say = (line) => console.log(`${stamp()} ${line}`);

const blocksOf = (out, probes) => Object.fromEntries(probes.map(([id]) => {
  const match = out.match(new RegExp(`^@@BEGIN-${id}\\n([\\s\\S]*?)^@@END-${id}$`, 'm'));
  return [id, match ? match[1].split('\n').filter((line) => !/^thebird /.test(line)).join('\n').trimEnd() : null];
}));

const seen = new Set();
function streamProbes(text) {
  for (const [, id] of text.matchAll(/^@@BEGIN-(\S+)$/gm)) {
    if (seen.has(`begin ${id}`)) continue;
    seen.add(`begin ${id}`);
    say(`live probe ${id} started`);
  }
  for (const [, id] of text.matchAll(/^@@END-(\S+)$/gm)) {
    if (seen.has(`end ${id}`)) continue;
    seen.add(`end ${id}`);
    say(`live probe ${id} finished`);
  }
}

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'lint-workspace-'));
  const profile = mkdtempSync(join(tmpdir(), 'lint-profile-'));
  say(`live: chromium ${chrome}, profile ${profile}`);
  const relay = await startRelay({});
  say(`live: relay listening on ${relay.url}`);
  const corsHost = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('cors-host-hello\n');
  });
  await new Promise((ok) => corsHost.listen(0, '127.0.0.1', ok));
  const corsPort = corsHost.address().port;
  try {
    const probes = [...PROBES, ['curl-cors', `curl -s http://127.0.0.1:${corsPort}/hello`]];
    const pairs = probes.flatMap(([id, command]) => [['run', `echo @@BEGIN-${id}`], ['run', command], ['run', `echo @@END-${id}`]]);
    say(`live: terminal starts with ${probes.length} probes, limit ${TERMINAL_LIMIT_MS} ms`);
    const state = await runTerminal({ chrome, profile, url: relay.url + '?' + new URLSearchParams(pairs).toString(), timeoutMs: TERMINAL_LIMIT_MS, onProgress: streamProbes });
    streamProbes(state.out);
    say(`live: terminal finished, engine ${state.engine}`);
    console.log('LIVE-RESULT ' + JSON.stringify(blocksOf(state.out, probes)));
  } finally {
    say('live: closing relay');
    await relay.close();
    say('live: relay closed');
    corsHost.close();
    for (const dir of [workspace, profile]) rmSync(dir, { recursive: true, force: true });
    say('live: temporary directories removed');
  }
}

main().then(() => process.exit(0), (error) => {
  say(`live error: ${error.message}`);
  process.exit(1);
});
