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
  '--gunzip': 'z',
  '--ungzip': 'z',
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
  if (letter === 'z') {
    options.gzip = true;
    return '';
  }
  if ('jJ'.includes(letter)) return 'tar: compression is not supported';
  if ('ruA'.includes(letter)) return 'tar: append, update and concatenate are not supported';
  return `tar: invalid option -- '${letter}'`;
}

function tarAssign(options, letter, value) {
  if (letter === 'f') options.archive = value;
  if (letter === 'C') options.directory = value;
}

function tarOptions(argv) {
  const options = { modes: [], verbose: false, gzip: false, archive: '-', directory: '', members: [], error: '' };
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
  return bytes;
}

const tarCrcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function tarCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = tarCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function tarGzipStored(bytes) {
  const parts = [new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3])];
  let offset = 0;
  do {
    const length = Math.min(0xffff, bytes.length - offset);
    const last = offset + length === bytes.length ? 1 : 0;
    parts.push(new Uint8Array([last, length & 0xff, length >>> 8, ~length & 0xff, (~length >>> 8) & 0xff]), bytes.subarray(offset, offset + length));
    offset += length;
  } while (offset < bytes.length);
  const trailer = new DataView(new ArrayBuffer(8));
  trailer.setUint32(0, tarCrc32(bytes), true);
  trailer.setUint32(4, bytes.length, true);
  parts.push(new Uint8Array(trailer.buffer));
  return tarConcat(parts);
}

const tarLengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const tarLengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const tarDistanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const tarDistanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const tarCodeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function tarHuffman(lengths) {
  const count = new Uint16Array(16);
  for (const length of lengths) count[length]++;
  count[0] = 0;
  const offset = new Uint16Array(16);
  for (let length = 1; length < 15; length++) offset[length + 1] = offset[length] + count[length];
  const symbols = new Uint16Array(lengths.length);
  lengths.forEach((length, symbol) => {
    if (length) symbols[offset[length]++] = symbol;
  });
  return { count, symbols };
}

const tarFixedLiteral = tarHuffman([...Array(144).fill(8), ...Array(112).fill(9), ...Array(24).fill(7), ...Array(8).fill(8)]);
const tarFixedDistance = tarHuffman(Array(30).fill(5));

function tarInflate(input, start) {
  const output = [];
  let position = start;
  let buffer = 0;
  let held = 0;
  const bits = (need) => {
    while (held < need) {
      if (position >= input.length) throw new Error('unexpected end of file');
      buffer |= input[position++] << held;
      held += 8;
    }
    const value = buffer & ((1 << need) - 1);
    buffer >>>= need;
    held -= need;
    return value;
  };
  const decode = (table) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length < 16; length++) {
      code |= bits(1);
      const count = table.count[length];
      if (code - count < first) return table.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('invalid code');
  };
  const codes = (literal, distance) => {
    for (;;) {
      const symbol = decode(literal);
      if (symbol < 256) {
        output.push(symbol);
        continue;
      }
      if (symbol === 256) return;
      const lengthIndex = symbol - 257;
      if (lengthIndex >= 29) throw new Error('invalid literal/length code');
      const length = tarLengthBase[lengthIndex] + bits(tarLengthExtra[lengthIndex]);
      const distanceIndex = decode(distance);
      if (distanceIndex >= 30) throw new Error('invalid distance code');
      const back = tarDistanceBase[distanceIndex] + bits(tarDistanceExtra[distanceIndex]);
      if (back > output.length) throw new Error('invalid distance too far back');
      for (let copied = 0; copied < length; copied++) output.push(output[output.length - back]);
    }
  };
  const dynamic = () => {
    const literals = bits(5) + 257;
    const distances = bits(5) + 1;
    const lengthCodes = bits(4) + 4;
    const order = new Array(19).fill(0);
    for (let index = 0; index < lengthCodes; index++) order[tarCodeLengthOrder[index]] = bits(3);
    const lengthTable = tarHuffman(order);
    const lengths = [];
    while (lengths.length < literals + distances) {
      const symbol = decode(lengthTable);
      if (symbol < 16) {
        lengths.push(symbol);
        continue;
      }
      let value = 0;
      let repeat;
      if (symbol === 16) {
        if (!lengths.length) throw new Error('invalid bit length repeat');
        value = lengths[lengths.length - 1];
        repeat = 3 + bits(2);
      } else if (symbol === 17) repeat = 3 + bits(3);
      else repeat = 11 + bits(7);
      for (let index = 0; index < repeat; index++) lengths.push(value);
    }
    if (lengths.length !== literals + distances) throw new Error('invalid bit length repeat');
    return { literal: tarHuffman(lengths.slice(0, literals)), distance: tarHuffman(lengths.slice(literals)) };
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buffer = 0;
      held = 0;
      if (position + 4 > input.length) throw new Error('unexpected end of file');
      const length = input[position] | (input[position + 1] << 8);
      if (length !== (~(input[position + 2] | (input[position + 3] << 8)) & 0xffff)) throw new Error('invalid stored block lengths');
      position += 4;
      if (position + length > input.length) throw new Error('unexpected end of file');
      for (let index = 0; index < length; index++) output.push(input[position + index]);
      position += length;
    } else if (type === 1) {
      codes(tarFixedLiteral, tarFixedDistance);
    } else if (type === 2) {
      const tables = dynamic();
      codes(tables.literal, tables.distance);
    } else throw new Error('invalid block type');
  } while (!last);
  return { bytes: Uint8Array.from(output), end: position };
}

function tarGunzip(bytes) {
  if (bytes.length < 18) throw new Error('unexpected end of file');
  if (bytes[2] !== 8) throw new Error('unknown compression method');
  const flags = bytes[3];
  let position = 10;
  if (flags & 4) position += 2 + (bytes[position] | (bytes[position + 1] << 8));
  for (const flag of [8, 16]) {
    if (flags & flag) {
      while (position < bytes.length && bytes[position] !== 0) position++;
      position++;
    }
  }
  if (flags & 2) position += 2;
  const { bytes: data, end } = tarInflate(bytes, position);
  if (end + 8 > bytes.length) throw new Error('unexpected end of file');
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + end, 8);
  if (trailer.getUint32(0, true) !== tarCrc32(data)) throw new Error('invalid compressed data--crc error');
  if (trailer.getUint32(4, true) !== data.length) throw new Error('invalid compressed data--length error');
  return data;
}

function tarGzipChildFailure(reason) {
  return `gzip: stdin: ${reason}\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now`;
}

function tarUnpack(bytes, required) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return required ? { error: tarGzipChildFailure('not in gzip format') } : { bytes };
  try {
    return { bytes: tarGunzip(bytes) };
  } catch (error) {
    return { error: tarGzipChildFailure(error.message) };
  }
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

function tarParse(bytes) {
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
  if (toStdout) {
    if (options.gzip) return tarFailure('tar: compressed archive to standard output is not supported');
    return { code, out: new TextDecoder().decode(archive), err: err + listing };
  }
  host.write(archivePath, options.gzip ? tarGzipStored(archive) : archive);
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
  if (options.archive === '-') return { bytes: new TextEncoder().encode(ctx.stdin ?? '') };
  const missing = options.gzip
    ? `tar (child): ${options.archive}: Cannot open: No such file or directory\ntar (child): Error is not recoverable: exiting now\ntar: Child returned status 2\ntar: Error is not recoverable: exiting now`
    : `tar: ${options.archive}: Cannot open: No such file or directory`;
  const path = ctx.resolve(options.archive);
  const info = ctx.host.stat(path);
  if (!info) return { error: missing };
  if (info.dir) return { error: `tar: ${options.archive}: Cannot read: Is a directory` };
  try {
    return { bytes: ctx.host.readBytes(path) };
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
  const unpacked = tarUnpack(source.bytes, options.gzip);
  if (unpacked.error) return tarFailure(unpacked.error);
  const { members, error } = tarParse(unpacked.bytes);
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
