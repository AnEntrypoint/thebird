const SED_REGEX_SPECIALS = '.*+?^${}()|[]\\';
const SED_COMMAND_ENDS = ';\n';

class SedScriptError {
  constructor(position, message) {
    this.position = position;
    this.message = message;
  }
}

function sedFail(state, message) {
  throw new SedScriptError(Math.min(state.pos + 1, state.script.length), message);
}

function sedSkipBlanks(state) {
  while (state.pos < state.script.length && (state.script[state.pos] === ' ' || state.script[state.pos] === '\t')) state.pos++;
}

function sedReadDelimited(state, delimiter, forRegex, message) {
  const { script } = state;
  let text = '';
  while (state.pos < script.length) {
    const c = script[state.pos];
    if (c === delimiter) {
      state.pos++;
      return text;
    }
    if (c === '\n') sedFail(state, message);
    if (c === '\\') {
      if (state.pos + 1 >= script.length) {
        state.pos = script.length;
        sedFail(state, message);
      }
      const next = script[state.pos + 1];
      if (next === delimiter) {
        if (forRegex) text += SED_REGEX_SPECIALS.includes(next) ? '\\' + next : next;
        else text += next === '&' ? '\\&' : next;
      } else text += '\\' + next;
      state.pos += 2;
      continue;
    }
    text += c;
    state.pos++;
  }
  sedFail(state, message);
}

function sedCompile(state, source, flags) {
  try {
    return new RegExp(source, flags);
  } catch (error) {
    if (error instanceof SyntaxError) sedFail(state, 'invalid regular expression');
    throw error;
  }
}

function sedParseAddress(state) {
  const { script } = state;
  const c = script[state.pos];
  if (c >= '0' && c <= '9') {
    let digits = '';
    while (state.pos < script.length && script[state.pos] >= '0' && script[state.pos] <= '9') digits += script[state.pos++];
    return { kind: 'line', line: Number(digits) };
  }
  if (c === '$') {
    state.pos++;
    return { kind: 'last' };
  }
  if (c === '/') {
    state.pos++;
    const source = sedReadDelimited(state, '/', true, 'unterminated address regex');
    let flags = '';
    if (script[state.pos] === 'I') {
      flags = 'i';
      state.pos++;
    }
    return { kind: 'regex', regex: sedCompile(state, source, flags) };
  }
  return null;
}

function sedHighestReference(replacement) {
  let highest = 0;
  for (let i = 0; i < replacement.length; i++) {
    if (replacement[i] !== '\\') continue;
    const next = replacement[++i];
    if (next >= '1' && next <= '9') highest = Math.max(highest, Number(next));
  }
  return highest;
}

function sedParseSubstitute(state) {
  const { script } = state;
  const unterminated = "unterminated 's' command";
  const delimiter = script[state.pos];
  if (delimiter === undefined || delimiter === '\n' || delimiter === '\\') sedFail(state, unterminated);
  state.pos++;
  const source = sedReadDelimited(state, delimiter, true, unterminated);
  const replacement = sedReadDelimited(state, delimiter, false, unterminated);
  let global = false;
  let ignoreCase = false;
  let print = false;
  while (state.pos < script.length && 'gipI'.includes(script[state.pos])) {
    const flag = script[state.pos++];
    if (flag === 'g') global = true;
    else if (flag === 'p') print = true;
    else ignoreCase = true;
  }
  const regex = sedCompile(state, source, ignoreCase ? 'gi' : 'g');
  const groups = new RegExp(source + '|').exec('').length - 1;
  const highest = sedHighestReference(replacement);
  if (highest > groups) sedFail(state, `invalid reference \\${highest} on \`s' command's RHS`);
  sedSkipBlanks(state);
  if (state.pos < script.length && !SED_COMMAND_ENDS.includes(script[state.pos])) sedFail(state, "unknown option to `s'");
  return { name: 's', regex, replacement, global, print };
}

function sedParse(script) {
  const state = { script, pos: 0 };
  const commands = [];
  for (;;) {
    while (state.pos < script.length && ' \t;\n'.includes(script[state.pos])) state.pos++;
    if (state.pos >= script.length) return commands;
    const start = sedParseAddress(state);
    let end = null;
    sedSkipBlanks(state);
    if (start && script[state.pos] === ',') {
      state.pos++;
      sedSkipBlanks(state);
      end = sedParseAddress(state);
      if (!end) sedFail(state, "unexpected `,'");
      sedSkipBlanks(state);
    }
    if (state.pos >= script.length || script[state.pos] === '\n' || script[state.pos] === ';') {
      if (start) sedFail(state, 'missing command');
    }
    const letter = script[state.pos];
    let command;
    if (letter === 'p' || letter === 'd') {
      state.pos++;
      sedSkipBlanks(state);
      if (state.pos < script.length && !SED_COMMAND_ENDS.includes(script[state.pos])) sedFail(state, 'extra characters after command');
      command = { name: letter };
    } else if (letter === 's') {
      state.pos++;
      command = sedParseSubstitute(state);
    } else sedFail(state, `unknown command: '${letter}'`);
    command.start = start;
    command.end = end;
    commands.push(command);
  }
}

function sedAddressMatches(address, pattern, lineNumber, isLast) {
  if (address.kind === 'line') return lineNumber === address.line;
  if (address.kind === 'last') return isLast;
  return address.regex.test(pattern);
}

function sedSelects(command, range, pattern, lineNumber, isLast) {
  if (!command.start) return true;
  if (!command.end) return sedAddressMatches(command.start, pattern, lineNumber, isLast);
  if (range.active) {
    if (command.end.kind === 'line') {
      if (lineNumber >= command.end.line) range.active = false;
    } else if (sedAddressMatches(command.end, pattern, lineNumber, isLast)) range.active = false;
    return true;
  }
  if (!sedAddressMatches(command.start, pattern, lineNumber, isLast)) return false;
  if (command.end.kind === 'line') range.active = command.end.line > lineNumber;
  else range.active = !isLast;
  return true;
}

function sedExpand(replacement, match) {
  let text = '';
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i];
    if (c === '\\' && i + 1 < replacement.length) {
      const next = replacement[++i];
      if (next >= '1' && next <= '9') text += match[Number(next)] ?? '';
      else if (next === 'n') text += '\n';
      else if (next === 't') text += '\t';
      else text += next;
    } else if (c === '&') text += match[0];
    else text += c;
  }
  return text;
}

function sedSubstitute(command, pattern) {
  const { regex } = command;
  regex.lastIndex = 0;
  let text = '';
  let copied = 0;
  let changed = false;
  let nonEmptyEnd = -1;
  for (;;) {
    const match = regex.exec(pattern);
    if (!match) break;
    const empty = match[0].length === 0;
    if (empty && match.index === nonEmptyEnd) {
      if (match.index >= pattern.length) break;
      regex.lastIndex = match.index + 1;
      continue;
    }
    changed = true;
    text += pattern.slice(copied, match.index) + sedExpand(command.replacement, match);
    copied = match.index + match[0].length;
    if (!command.global) break;
    if (empty) {
      if (match.index >= pattern.length) break;
      regex.lastIndex = match.index + 1;
    } else nonEmptyEnd = copied;
  }
  if (!changed) return { changed, text: pattern };
  return { changed, text: text + pattern.slice(copied) };
}

function sedRunStream(commands, lines, quiet) {
  const ranges = commands.map(() => ({ active: false }));
  const printed = [];
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const isLast = index === lines.length - 1;
    let pattern = lines[index];
    let deleted = false;
    for (let c = 0; c < commands.length; c++) {
      const command = commands[c];
      if (!sedSelects(command, ranges[c], pattern, lineNumber, isLast)) continue;
      if (command.name === 'p') printed.push(pattern);
      else if (command.name === 'd') {
        deleted = true;
        break;
      } else {
        const result = sedSubstitute(command, pattern);
        if (result.changed) {
          pattern = result.text;
          if (command.print) printed.push(pattern);
        }
      }
    }
    if (!deleted && !quiet) printed.push(pattern);
  }
  return printed;
}

function sedSplit(text) {
  if (text === '') return { lines: [], trailingNewline: false };
  const lines = text.split('\n');
  const trailingNewline = lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

function sedJoin(printed, trailingNewline) {
  if (!printed.length) return '';
  const text = printed.join('\n');
  return trailingNewline ? text + '\n' : text;
}

function sedReadInput(ctx, name, allowStdin) {
  if (allowStdin && name === '-') return { text: ctx.stdin };
  const missing = { error: `sed: can't read ${name}: No such file or directory\n` };
  const path = ctx.resolve(name);
  const info = ctx.host.stat(path);
  if (!info) return missing;
  if (info.dir) return { error: allowStdin ? `sed: read error on ${name}: Is a directory\n` : `sed: couldn't edit ${name}: not a regular file\n` };
  try {
    return { path, text: ctx.host.read(path) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return missing;
    throw error;
  }
}

function sedParseOptions(argv) {
  const options = { quiet: false, inPlace: false, scripts: [], operands: [] };
  let optionsEnded = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (optionsEnded || arg === '-' || !arg.startsWith('-')) {
      options.operands.push(arg);
      continue;
    }
    if (arg === '--') {
      optionsEnded = true;
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j];
      if (letter === 'n') options.quiet = true;
      else if (letter === 'i') options.inPlace = true;
      else if (letter === 'E' || letter === 'r') continue;
      else if (letter === 'e') {
        const attached = arg.slice(j + 1);
        if (attached) options.scripts.push(attached);
        else if (i + 1 < argv.length) options.scripts.push(argv[++i]);
        else return { error: "sed: option requires an argument -- 'e'\n" };
        break;
      } else return { error: `sed: invalid option -- '${letter}'\n` };
    }
  }
  return options;
}

export function runSed(argv, ctx) {
  const options = sedParseOptions(argv);
  if (options.error) return { code: 1, out: '', err: options.error };
  const { operands } = options;
  if (!options.scripts.length) {
    if (!operands.length) return { code: 1, out: '', err: 'sed: no script specified\n' };
    options.scripts.push(operands.shift());
  }
  let commands;
  try {
    commands = sedParse(options.scripts.join('\n'));
  } catch (error) {
    if (error instanceof SedScriptError) return { code: 1, out: '', err: `sed: -e expression #1, char ${error.position}: ${error.message}\n` };
    throw error;
  }
  let code = 0;
  let err = '';
  if (options.inPlace) {
    if (!operands.length) return { code: 1, out: '', err: 'sed: no input files\n' };
    for (const name of operands) {
      const input = sedReadInput(ctx, name, false);
      if (input.error) {
        err += input.error;
        code = 2;
        continue;
      }
      const { lines, trailingNewline } = sedSplit(input.text);
      ctx.host.write(input.path, sedJoin(sedRunStream(commands, lines, options.quiet), trailingNewline));
    }
    return { code, out: '', err };
  }
  const lines = [];
  let trailingNewline = false;
  const names = operands.length ? operands : ['-'];
  for (const name of names) {
    const input = sedReadInput(ctx, name, true);
    if (input.error) {
      err += input.error;
      code = 2;
      continue;
    }
    const split = sedSplit(input.text);
    if (!split.lines.length) continue;
    lines.push(...split.lines);
    trailingNewline = split.trailingNewline;
  }
  return { code, out: sedJoin(sedRunStream(commands, lines, options.quiet), trailingNewline), err };
}
