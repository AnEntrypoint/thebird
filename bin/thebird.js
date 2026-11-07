#!/usr/bin/env node
import { runCli } from '../src/cli.js';

const argv = process.argv.slice(2);
const interactive = argv.includes('-i') || argv.includes('--repl') || (argv.length === 0 && Boolean(process.stdin.isTTY));
const filtered = argv.filter(a => a !== '-i' && a !== '--repl');
const code = await runCli({ argv: filtered, interactive });
process.exitCode = code;
