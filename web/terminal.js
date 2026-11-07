import { shellClient } from './shell-client.js';
import { AnsiParser } from './ansi.js';

const out = document.getElementById('out');
const line = document.getElementById('line');
const params = new URLSearchParams(location.search);
const colour = params.get('ansi') === 'color';
const ansi = new AnsiParser();
const append = (text) => {
  for (const segment of ansi.push(text)) {
    if (colour && segment.classes) {
      const span = document.createElement('span');
      span.className = segment.classes;
      span.textContent = segment.text;
      out.append(span);
    } else out.append(segment.text);
  }
};
const endLine = () => { if (!out.textContent.endsWith('\n')) append('\n'); };
const write = (text) => { endLine(); append(text + '\n'); };

const client = shellClient();
client.onOutput(append);
const prompt = document.getElementById('prompt');
const showPrompt = async () => {
  prompt.textContent = `thebird ${await client.cwd()}> `;
};
try {
  await client.ready;
  document.body.dataset.engine = 'ready';
  await showPrompt();
} catch (err) {
  document.body.dataset.engine = 'failed';
  write('engine error: ' + err.message);
}

const HISTORY_KEY = 'thebird.history';
const HISTORY_LIMIT = 500;
let saved = [];
try {
  saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
} catch {
  saved = [];
}
const typed = Array.isArray(saved) ? saved.filter((command) => typeof command === 'string') : [];
let position = typed.length;
let busy = false;
const remember = (command) => {
  typed.push(command);
  if (typed.length > HISTORY_LIMIT) typed.splice(0, typed.length - HISTORY_LIMIT);
  position = typed.length;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(typed));
  } catch {}
};
let queue = Promise.resolve();
let generation = 0;

async function execute(command) {
  write('thebird> ' + command);
  busy = true;
  document.body.dataset.busy = 'true';
  try {
    const result = await client.run(command);
    if (result.output) write(result.output.replace(/\n$/, ''));
  } catch (err) {
    write('error: ' + err.message);
  } finally {
    ansi.reset();
    endLine();
    busy = false;
    delete document.body.dataset.busy;
    await showPrompt();
  }
}

if (document.body.dataset.engine === 'ready') {
  for (const command of params.getAll('run')) await execute(command);
}
document.body.dataset.done = 'true';

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = line.value;
  line.value = '';
  if (command.trim() && typed.at(-1) !== command) remember(command);
  position = typed.length;
  const current = generation;
  queue = queue.then(() => (current === generation ? execute(command) : undefined)).catch((err) => write('error: ' + err.message));
});

const commonPrefix = (words) => words.reduce((prefix, word) => {
  let end = 0;
  while (end < prefix.length && prefix[end] === word[end]) end++;
  return prefix.slice(0, end);
});

line.addEventListener('keydown', async (event) => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    position = Math.min(typed.length, Math.max(0, position + (event.key === 'ArrowUp' ? -1 : 1)));
    line.value = typed[position] ?? '';
  } else if (event.ctrlKey && event.key === 'c' && busy) {
    event.preventDefault();
    generation++;
    client.cancel();
    write('^C');
  } else if (event.ctrlKey && event.key === 'u') {
    event.preventDefault();
    line.value = '';
  } else if (event.ctrlKey && event.key === 'a') {
    event.preventDefault();
    line.setSelectionRange(0, 0);
  } else if (event.ctrlKey && event.key === 'e') {
    event.preventDefault();
    line.setSelectionRange(line.value.length, line.value.length);
  } else if (event.ctrlKey && event.key === 'l') {
    event.preventDefault();
    out.textContent = '';
  } else if (event.key === 'Tab') {
    event.preventDefault();
    const token = /\S*$/.exec(line.value)[0];
    const before = line.value.slice(0, line.value.length - token.length);
    const matches = await client.complete(token, { command: before.trim() === '' });
    if (matches.length === 1) {
      line.value = line.value.slice(0, line.value.length - token.length) + matches[0] + (matches[0].endsWith('/') ? '' : ' ');
    } else if (matches.length > 1) {
      const shared = commonPrefix(matches);
      if (shared.length > token.length) line.value = line.value.slice(0, line.value.length - token.length) + shared;
      else write(matches.join('  '));
    }
  }
});
