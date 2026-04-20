import { registerStream, readStream } from './shell-procsub.js';
import { tokenize, globToRe } from './shell-parser.js';
import { fullExpand, expandBraces, expandTilde } from './shell-expand.js';
import { resolvePath } from './shell-builtins.js';
import { NODE_VERSION } from './shell-node-modules.js';

export function makeExpander(ctx, captureRun, parseRedirect) {
  const toKey = p => p.replace(/^\//, '');
  const snap = () => window.__debug.idbSnapshot || {};

  function replaceProcSub(token) {
    let out = ''; let i = 0;
    while (i < token.length) {
      if ((token[i] === '<' || token[i] === '>') && token[i + 1] === '(') {
        let depth = 1; let j = i + 2;
        while (j < token.length && depth > 0) { if (token[j] === '(') depth++; else if (token[j] === ')') depth--; if (depth) j++; }
        if (depth === 0) { out += registerStream(captureRun(token.slice(i + 2, j))); i = j + 1; continue; }
      }
      out += token[i++];
    }
    return out;
  }

  function expandGlob(token) {
    if (!token.includes('*') && !token.includes('?') && !token.includes('[')) return [token];
    const prefix = toKey(resolvePath(ctx.cwd, ''));
    const keys = Object.keys(snap()).map(k => prefix && k.startsWith(prefix + '/') ? k.slice(prefix.length + 1) : k);
    const re = globToRe(token);
    const matches = keys.filter(k => re.test(k));
    return matches.length ? matches.sort() : [token];
  }

  function expandTokens(tokens) {
    return tokens.flatMap(t => {
      const procsub = t.includes('<(') || t.includes('>(') ? replaceProcSub(t) : t;
      const tilde = expandTilde(procsub, ctx.env);
      const braces = expandBraces(tilde);
      return braces.flatMap(b => expandGlob(fullExpand(b, ctx.env, ctx.lastExitCode, ctx.argv, captureRun, ctx.arrays)));
    });
  }
  return { expandTokens, expandGlob, replaceProcSub };
}

export function makeCaptureRun(ctx, BUILTINS, actor, parseRedirect, expandTokens) {
  return function captureRun(line) {
    const raw = tokenize(line); if (!raw.length) return '';
    let out = ''; const orig = ctx.term.write.bind(ctx.term); ctx.term.write = s => { out += s; };
    try { const [cmd, ...args] = parseRedirect(expandTokens(raw)).args; BUILTINS[cmd]?.(args, actor); } finally { ctx.term.write = orig; }
    return out.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  };
}

const NODE_HELP = 'Usage: node [options] [script.js] [arguments]\r\n  -v, --version   print Node.js version\r\n  -e, --eval      evaluate script\r\n  -p, --print     evaluate and print result\r\n  -h, --help      print this help\r\n';

export function makeNodeRunner(ctx, actor) {
  const toKey = p => p.replace(/^\//, '');
  const snap = () => window.__debug.idbSnapshot || {};
  return async function runNode(args, stdinBuf) {
    const term = ctx.term;
    if (!args.length) { actor.send({ type: 'ENTER_REPL' }); term.write('Welcome to Node.js ' + NODE_VERSION + '.\r\nType ".help" for more information.\r\n> '); return; }
    const a0 = args[0];
    if (a0 === '-v' || a0 === '--version') { term.write(NODE_VERSION + '\r\n'); return; }
    if (a0 === '-h' || a0 === '--help') { term.write(NODE_HELP); return; }
    if (a0 === '-e' || a0 === '--eval') { await ctx.nodeEval(args.slice(1).join(' '), null, [], stdinBuf); return; }
    if (a0 === '-p' || a0 === '--print') { await ctx.nodeEval('process.stdout.write(String(' + args.slice(1).join(' ') + ') + "\\n")', null, [], stdinBuf); return; }
    const code = snap()[toKey(resolvePath(ctx.cwd, a0))];
    if (code == null) { term.write('\x1b[31mnode: ' + a0 + ': No such file or directory\x1b[0m\r\n'); ctx.lastExitCode = 1; return; }
    actor.send({ type: 'NODE_START' }); ctx.argv = args;
    try { await ctx.nodeEval(code, a0, args.slice(1), stdinBuf); } finally { ctx.argv = []; }
  };
}

export function makeNpmResultRunner(ctx, run) {
  return async function runNpmResult(r) {
    if (!r) return;
    if (r.runInShell) { await run(r.runInShell); return; }
    if (!r.npmChain) return;
    for (const step of r.npmChain) {
      ctx.term.write('\r\n> ' + r.pkgName + '@' + r.pkgVersion + ' ' + step.name + '\r\n> ' + step.cmd + '\r\n\r\n');
      ctx.env.npm_lifecycle_event = step.name;
      await run(step.cmd);
      if (ctx.lastExitCode !== 0) return;
    }
  };
}
