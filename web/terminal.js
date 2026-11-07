import { createRunner } from '/src/runner.js';
import { createApi } from '/src/api.js';
import { remoteClient } from '/src/gm-remote.js';

const out = document.getElementById('out');
const line = document.getElementById('line');
const write = (text) => { out.textContent += text + '\n'; };

const run = createRunner(createApi(await remoteClient({ url: location.origin + '/' })));

async function execute(command) {
  write('thebird> ' + command);
  try {
    const result = await run(command);
    if (result && result.exit !== true && result !== '') write(String(result));
  } catch (err) {
    write('error: ' + err.message);
  }
}

for (const command of new URLSearchParams(location.search).getAll('run')) await execute(command);
document.body.dataset.done = 'true';

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const command = line.value;
  line.value = '';
  await execute(command);
});
