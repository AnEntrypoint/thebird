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

async function execute(command) {
  write('thebird> ' + command);
  try {
    const result = await run(command);
    if (result && result.exit !== true && result !== '') write(String(result));
  } catch (err) {
    write('error: ' + err.message);
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
  await execute(command);
});
