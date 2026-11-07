import readline from 'node:readline/promises';
import { stdin as input, stdout as output, stderr as errorOutput } from 'node:process';
import { resolve } from 'node:path';
import { createThebird } from './index.js';
import { helpText } from './commands.js';
import { createRunner } from './runner.js';

export { createRunner };

function quoteArg(arg) {
  return /^[^\s"'\\]+$/.test(arg) ? arg : '"' + arg.replace(/[\\"]/g, '\\$&') + '"';
}

export async function runCli({ argv = process.argv.slice(2), interactive = false, stdin = input, stdout = output, stderr = errorOutput } = {}) {
  const options = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') options.workspace = resolve(argv[++i]);
    else if (argv[i] === '--gm-home') options.gmHome = resolve(argv[++i]);
    else if (argv[i] === '--json') options.json = true;
    else rest.push(argv[i]);
  }
  options.gmHome ??= process.env.GM_HOME;
  if (rest.length === 1 && (rest[0] === 'help' || rest[0] === '--help' || rest[0] === '-h') && !interactive) {
    stdout.write('thebird — gm-backed CLI\n\n' + helpText() + '\n');
    return 0;
  }
  const api = await createThebird(options);
  const run = createRunner(api);
  let code = 0;
  try {
    if (rest.length === 0 && !interactive) {
      stdout.write('thebird — gm-backed CLI\n\n' + helpText() + '\n');
    } else if (rest.length > 0) {
      const line = rest.map(quoteArg).join(' ');
      try {
        const result = await run(line);
        if (result && result.exit !== true) stdout.write(String(result) + '\n');
      } catch (err) {
        code = 1;
        stderr.write('error: ' + err.message + '\n');
      }
    }
    if (interactive || rest.length === 0) {
      const rl = readline.createInterface({ input: stdin, output, terminal: Boolean(stdin.isTTY) });
      let ended = false;
      const finishInput = () => { ended = true; rl.close(); };
      rl.on('close', () => { ended = true; });
      stdin.once('end', finishInput);
      stdout.write('thebird (gm ' + api.client.gmHome + ')\nType help; exit quits.\n');
      for (;;) {
        if (ended) break;
        let line;
        try { line = await Promise.race([rl.question('thebird> '), new Promise(resolve => rl.once('close', () => resolve(null)))]); } catch { break; }
        if (line === null) break;
        if (line.trim() === 'exit' || line.trim() === 'quit') break;
        try {
          const result = await run(line);
          if (result && result.exit === true) break;
          if (result) stdout.write(String(result) + '\n');
        } catch (err) {
          code = 1;
          stdout.write('error: ' + err.message + '\n');
        }
      }
      rl.close();
    }
  } finally {
    await api.close();
  }
  return code;
}

export default runCli;
