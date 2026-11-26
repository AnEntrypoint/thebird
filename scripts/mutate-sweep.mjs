import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [target, outFile, ...flags] = process.argv.slice(2);
if (!target || !outFile) throw new Error('usage: mutate-sweep.mjs <file> <results.json> [--count]');
const file = resolve(root, target);
const original = readFileSync(file, 'utf8');
const lines = original.split('\n');

const RULES = [
  [/===/g, '!=='], [/!==/g, '==='], [/ == /g, ' != '], [/ != /g, ' == '],
  [/&&/g, '||'], [/\|\|/g, '&&'],
  [/ \+ /g, ' - '], [/ - /g, ' + '], [/ \* /g, ' \/ '], [/ \/ /g, ' * '], [/ % /g, ' * '],
  [/ < /g, ' <= '], [/ <= /g, ' < '], [/ > /g, ' >= '], [/ >= /g, ' > '],
  [/ << /g, ' >> '], [/ >> /g, ' << '], [/ & /g, ' | '], [/ \| /g, ' & '], [/ \^ /g, ' & '],
  [/\b0n\b/g, '1n'], [/\b1n\b/g, '0n'],
  [/'[^'\n]+'/g, '+X'],
];

const substitute = (match, replacement) => (replacement === '+X' ? match.slice(0, -1) + 'X' + match.slice(-1) : replacement);

const mutants = [];
lines.forEach((line, index) => {
  if (/^\s*\/\//.test(line)) return;
  RULES.forEach(([pattern, replacement], rule) => {
    [...line.matchAll(pattern)].forEach((match, occurrence) => mutants.push({ line: index + 1, rule, occurrence, from: match[0], to: replacement }));
  });
});

const bound = (flag, fallback) => {
  const hit = flags.find((flagText) => flagText.startsWith(flag + '='));
  return hit === undefined ? fallback : Number(hit.slice(flag.length + 1));
};
const selectedMutants = mutants.slice(bound('--from', 0), bound('--to', mutants.length));
if (flags.includes('--count')) {
  console.log('mutants', mutants.length);
  process.exit(0);
}

const mutated = (mutant) => {
  const copy = lines.slice();
  let count = -1;
  copy[mutant.line - 1] = lines[mutant.line - 1].replace(RULES[mutant.rule][0], (match) => {
    count += 1;
    return count === mutant.occurrence ? substitute(match, mutant.to) : match;
  });
  return copy.join('\n');
};

const runWitness = () => new Promise((resolveRun) => {
  const child = spawn(process.execPath, [join(root, 'scripts', 'witness-shell.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let text = '';
  child.stdout.on('data', (chunk) => { text += chunk; });
  child.stderr.on('data', (chunk) => { text += chunk; });
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 90000);
  child.on('close', () => { clearTimeout(timer); resolveRun(text); });
});

let live = false;
const restore = () => { if (live) writeFileSync(file, original); live = false; };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { restore(); process.exit(130); });

const results = [];
try {
  for (const mutant of selectedMutants) {
    live = true;
    writeFileSync(file, mutated(mutant));
    const text = await runWitness();
    restore();
    const rows = text.split('\n');
    const result = rows.find((row) => row.startsWith('RESULT')) ?? null;
    const fails = rows.filter((row) => row.startsWith('FAIL')).map((row) => row.slice(0, 160));
    const hang = result === null;
    const status = hang || fails.length > 0 ? 'caught' : 'survived';
    results.push({ ...mutant, status, hang, result, fails: fails.slice(0, 3), original: lines[mutant.line - 1].trim() });
    writeFileSync(outFile, JSON.stringify(results, null, 1));
  }
} finally {
  restore();
}
const tally = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
console.log('TALLY', JSON.stringify(tally), 'total', results.length);
