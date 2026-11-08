const tarBlockSize = 512;

const tarLongOptions = {
  '--create': 'c',
  '--extract': 'x',
  '--get': 'x',
  '--list': 't',
  '--verbose': 'v',
  '--file': 'f',
  '--directory': 'C',
  '--gzip': 'z',
  '--bzip2': 'j',
  '--xz': 'J',
};

function tarLetter(options, letter) {
  if ('cxt'.includes(letter)) {
    options.modes.push(letter);
    return '';
  }
  if (letter === 'v') {
    options.verbose = true;
    return '';
  }
  if (letter === 'f' || letter === 'C' || letter === 'p' || letter === 'o') return '';
  if ('zjJ'.includes(letter)) return 'tar: compression is not supported';
  if ('ruA'.includes(letter)) return 'tar: append, update and concatenate are not supported';
  return `tar: invalid option -- '${letter}'`;
}

function tarAssign(options, letter, value) {
  if (letter === 'f') options.archive = value;
  if (letter === 'C') options.directory = value;
}

function tarOptions(argv) {
  const options = { modes: [], verbose: false, archive: '-', directory: '', members: [], error: '' };
  const fail = (message) => Object.assign(options, { error: message });
  let index = 0;
  while (index < argv.length) {
    const word = argv[index++];
    const oldStyle = index === 1 && !word.startsWith('-');
    if (word === '--') {
      options.members.push(...argv.slice(index));
      break;
    }
    if (word.startsWith('--')) {
      const equals = word.indexOf('=');
      const flag = equals === -1 ? word : word.slice(0, equals);
      const letter = tarLongOptions[flag];
      if (!letter) return fail(`tar: unrecognized option '${word}'`);
      const problem = tarLetter(options, letter);
      if (problem) return fail(problem);
      if (letter === 'f' || letter === 'C') {
        if (equals !== -1) tarAssign(options, letter, word.slice(equals + 1));
        else if (index < argv.length) tarAssign(options, letter, argv[index++]);
        else return fail(`tar: option '${flag}' requires an argument`);
      }
      continue;
    }
    if (!oldStyle && !(word.startsWith('-') && word.length > 1)) {
      options.members.push(word);
      continue;
    }
    const letters = oldStyle ? word : word.slice(1);
    for (let position = 0; position < letters.length; position++) {
      const letter = letters[position];
      const problem = tarLetter(options, letter);
      if (problem) return fail(problem);
      if (letter !== 'f' && letter !== 'C') continue;
      if (!oldStyle && position + 1 < letters.length) {
        tarAssign(options, letter, letters.slice(position + 1));
        break;
      }
      if (index >= argv.length) return fail(`tar: option requires an argument -- '${letter}'`);
      tarAssign(options, letter, argv[index++]);
    }
  }
  return options;
}

function tarPut(block, offset, text) {
  for (let index = 0; index < text.length; index++) block[offset + index] = text.charCodeAt(index);
}

function tarOctal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(nameBytes, size, typeflag, mode) {
  const block = new Uint8Array(tarBlockSize);
  block.set(nameBytes, 0);
  tarPut(block, 100, tarOctal(mode, 8));
  tarPut(block, 108, tarOctal(0, 8));
  tarPut(block, 116, tarOctal(0, 8));
  tarPut(block, 124, tarOctal(size, 12));
  tarPut(block, 136, tarOctal(0, 12));
  tarPut(block, 148, '        ');
  tarPut(block, 156, typeflag);
  tarPut(block, 257, 'ustar\0');
  tarPut(block, 263, '00');
  tarPut(block, 265, 'user');
  tarPut(block, 297, 'user');
  tarPut(block, 329, tarOctal(0, 8));
  tarPut(block, 337, tarOctal(0, 8));
  const sum = block.reduce((total, byte) => total + byte, 0);
  tarPut(block, 148, sum.toString(8).padStart(6, '0') + '\0 ');
  return block;
}

function tarConcat(chunks) {
  const total = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function tarText(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end));
}

function tarChecksumMatches(block) {
  let sum = 0;
  for (let index = 0; index < tarBlockSize; index++) sum += index >= 148 && index < 156 ? 32 : block[index];
  const stored = tarText(block, 148, 8).trim();
  return /^[0-7]+$/.test(stored) && parseInt(stored, 8) === sum;
}

function tarParse(text) {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const members = [];
  const notArchive = 'tar: This does not look like a tar archive';
  let offset = 0;
  while (offset + tarBlockSize <= bytes.length) {
    const block = bytes.subarray(offset, offset + tarBlockSize);
    if (block.every((byte) => byte === 0)) return { members, error: '' };
    if (!tarChecksumMatches(block)) return { members, error: notArchive };
    const sizeText = tarText(block, 124, 12).trim();
    if (!/^[0-7]*$/.test(sizeText)) return { members, error: notArchive };
    const size = sizeText ? parseInt(sizeText, 8) : 0;
    const isUstar = tarText(block, 257, 6) === 'ustar' && block[262] === 0;
    const prefix = isUstar ? tarText(block, 345, 155) : '';
    const baseName = tarText(block, 0, 100);
    const name = prefix ? `${prefix}/${baseName}` : baseName;
    const typeflag = String.fromCharCode(block[156]);
    const start = offset + tarBlockSize;
    if (start + size > bytes.length) return { members, error: 'tar: Unexpected EOF in archive' };
    if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      members.push({ name, dir: false, content: decoder.decode(bytes.subarray(start, start + size)) });
    } else if (typeflag === '5') {
      members.push({ name, dir: true, content: '' });
    } else {
      return { members, error: 'tar: unsupported member type' };
    }
    offset = start + Math.ceil(size / tarBlockSize) * tarBlockSize;
  }
  if (offset === 0 && bytes.length > 0) return { members, error: notArchive };
  if (offset < bytes.length) return { members, error: 'tar: Unexpected EOF in archive' };
  return { members, error: '' };
}

function tarFailure(message) {
  return { code: 2, out: '', err: message + '\n' };
}

function tarCreate(options, ctx) {
  const { host } = ctx;
  if (!options.members.length) return tarFailure('tar: Cowardly refusing to create an empty archive');
  const toStdout = options.archive === '-';
  const archivePath = toStdout ? '' : ctx.resolve(options.archive);
  const encoder = new TextEncoder();
  const chunks = [];
  let names = '';
  let err = '';
  let code = 0;
  const addMember = (display, path) => {
    const info = host.stat(path);
    if (!info) {
      err += `tar: ${display}: Cannot stat: No such file or directory\n`;
      code = 2;
      return;
    }
    if (path === archivePath) return;
    const trimmed = display.replace(/\/+$/, '');
    const memberName = (info.dir ? trimmed + '/' : display).replace(/^\/+/, '');
    if (memberName) {
      const nameBytes = encoder.encode(memberName);
      if (nameBytes.length > 100) {
        err += `tar: ${memberName}: file name is too long (cannot be split)\n`;
        code = 2;
      } else {
        const content = info.dir ? new Uint8Array(0) : encoder.encode(host.read(path));
        chunks.push(tarHeader(nameBytes, content.length, info.dir ? '5' : '0', info.dir ? 0o755 : 0o644));
        const padding = (tarBlockSize - (content.length % tarBlockSize)) % tarBlockSize;
        if (content.length) chunks.push(content);
        if (padding) chunks.push(new Uint8Array(padding));
        names += memberName + '\n';
      }
    }
    if (!info.dir) return;
    for (const entry of host.list(path).slice().sort()) {
      addMember(`${trimmed}/${entry}`, path === '/' ? `/${entry}` : `${path}/${entry}`);
    }
  };
  for (const name of options.members) addMember(name, ctx.resolve(name));
  chunks.push(new Uint8Array(tarBlockSize * 2));
  const archive = tarConcat(chunks);
  const listing = options.verbose ? names : '';
  if (toStdout) return { code, out: archive, err: err + listing };
  host.write(archivePath, archive);
  return { code, out: listing, err };
}

function tarMakeDirectories(host, path) {
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += '/' + part;
    if (!host.exists(current)) host.mkdir(current);
    else {
      const info = host.stat(current);
      if (info && !info.dir) return 'Cannot mkdir: Not a directory';
    }
  }
  return '';
}

function tarJoinPath(base, parts) {
  if (!parts.length) return base;
  return `${base === '/' ? '' : base}/${parts.join('/')}`;
}

function tarReadArchive(options, ctx) {
  if (options.archive === '-') return { text: ctx.stdin ?? '' };
  const missing = `tar: ${options.archive}: Cannot open: No such file or directory`;
  const path = ctx.resolve(options.archive);
  const info = ctx.host.stat(path);
  if (!info) return { error: missing };
  if (info.dir) return { error: `tar: ${options.archive}: Cannot read: Is a directory` };
  try {
    return { text: ctx.host.read(path) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { error: missing };
    throw error;
  }
}

function tarExtractMember(host, destination, member) {
  const parts = member.name.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) return "Member name contains '..'";
  const target = tarJoinPath(destination, parts);
  if (member.dir) return tarMakeDirectories(host, target);
  const problem = tarMakeDirectories(host, tarJoinPath(destination, parts.slice(0, -1)));
  if (problem) return problem;
  const info = host.stat(target);
  if (info && info.dir) return 'Cannot open: Is a directory';
  host.write(target, member.content);
  return '';
}

function tarRead(options, ctx, mode) {
  const source = tarReadArchive(options, ctx);
  if (source.error) return tarFailure(source.error);
  const { members, error } = tarParse(source.text);
  let out = '';
  let err = '';
  let code = 0;
  if (mode === 't') {
    for (const member of members) out += member.name + '\n';
  } else {
    const destination = options.directory ? ctx.resolve(options.directory) : ctx.cwd;
    const problem = tarMakeDirectories(ctx.host, destination);
    if (problem) return tarFailure(`tar: ${options.directory || destination}: ${problem}`);
    for (const member of members) {
      const failure = tarExtractMember(ctx.host, destination, member);
      if (failure) {
        err += `tar: ${member.name}: ${failure}\n`;
        code = 2;
      } else if (options.verbose) {
        out += member.name + '\n';
      }
    }
  }
  if (error) {
    err += error + '\n';
    code = 2;
  }
  return { code, out, err };
}

export function runTar(argv, ctx) {
  const options = tarOptions(argv);
  if (options.error) return tarFailure(options.error);
  const modes = new Set(options.modes);
  if (!modes.size) return tarFailure('tar: You must specify one of the -ctx options');
  if (modes.size > 1) return tarFailure('tar: You may not specify more than one of the -ctx options');
  const [mode] = modes;
  if (mode === 'c') return tarCreate(options, ctx);
  return tarRead(options, ctx, mode);
}
