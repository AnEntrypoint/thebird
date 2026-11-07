import { createRunner } from '/src/runner.js';
import { createApi } from '/src/api.js';
import { remoteClient } from '/src/gm-remote.js';
import { workerClient } from '/web/gm-worker-client.js';

const out = document.getElementById('out');
const line = document.getElementById('line');
const write = (text) => { out.textContent += text + '\n'; };
const params = new URLSearchParams(location.search);

async function engine() {
  if (params.get('engine') === 'relay') return remoteClient({ url: location.origin + '/' });
  return workerClient({ raw: params.get('gm') === 'raw' });
}

const client = await engine();
try {
  await client.ready;
  document.body.dataset.engine = 'ready';
} catch (err) {
  document.body.dataset.engine = 'failed';
  write('engine error: ' + err.message);
}

const run = createRunner(createApi(client));

const typed = [];
let position = 0;
let busy = false;

async function execute(command) {
  write('thebird> ' + command);
  busy = true;
  document.body.dataset.busy = 'true';
  try {
    const result = await run(command);
    if (result && result.exit !== true && result !== '') write(String(result));
  } catch (err) {
    write('error: ' + err.message);
  } finally {
    busy = false;
    delete document.body.dataset.busy;
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
  if (command.trim() && typed.at(-1) !== command) typed.push(command);
  position = typed.length;
  await execute(command);
});

line.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    position = Math.min(typed.length, Math.max(0, position + (event.key === 'ArrowUp' ? -1 : 1)));
    line.value = typed[position] ?? '';
  } else if (event.ctrlKey && event.key === 'c' && busy && client.cancel) {
    event.preventDefault();
    client.cancel();
    write('^C');
  }
});
