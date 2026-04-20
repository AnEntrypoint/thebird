import { registerStream, readStream } from './shell-procsub.js';
import { tokenize, globToRe } from './shell-parser.js';
import { fullExpand, expandBraces, expandTilde } from './shell-expand.js';
import { resolvePath } from './shell-builtins.js';

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
