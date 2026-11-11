import { xtermAdapter } from './vendor/fx/xterm.js';

const CELL_BYTES = 16;
const GRAPHEME_CAPACITY = 16;
const FLAG = { BOLD: 1, ITALIC: 2, UNDERLINE: 4, STRIKETHROUGH: 8, INVERSE: 16, INVISIBLE: 32, BLINK: 64, FAINT: 128 };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let vtExports = null;
let vtLoading = null;

export const loadGhosttyVt = (url) => {
  vtLoading ??= (async () => {
    const bytes = await (await fetch(url)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        log: (pointer, length) => console.log(decoder.decode(new Uint8Array(vtExports.memory.buffer, pointer, length))),
      },
    });
    vtExports = instance.exports;
    return vtExports;
  })();
  return vtLoading;
};

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

const paletteEntries = () => {
  const entries = new Map();
  for (let index = 16; index < 232; index++) {
    const cube = index - 16;
    const rgb = [CUBE_LEVELS[Math.floor(cube / 36)], CUBE_LEVELS[Math.floor(cube / 6) % 6], CUBE_LEVELS[cube % 6]];
    entries.set(rgb.join(';'), index);
  }
  for (let index = 232; index < 256; index++) {
    const level = 8 + (index - 232) * 10;
    entries.set([level, level, level].join(';'), index);
  }
  return entries;
};

const PALETTE = paletteEntries();

const colourSgr = (value, base) => {
  const index = PALETTE.get(value.join(';'));
  return index === undefined ? `${base};2;${value.join(';')}` : `${base};5;${index}`;
};

const sgrFor = (cell) => {
  const inverse = (cell.flags & FLAG.INVERSE) !== 0;
  let foreground = inverse ? cell.bg : cell.fg;
  const background = inverse ? cell.fg : cell.bg;
  if (cell.flags & FLAG.INVISIBLE) foreground = background;
  let attributes = '0';
  if (cell.flags & FLAG.BOLD) attributes += ';1';
  if (cell.flags & FLAG.FAINT) attributes += ';2';
  if (cell.flags & FLAG.ITALIC) attributes += ';3';
  if (cell.flags & FLAG.UNDERLINE) attributes += ';4';
  if (cell.flags & FLAG.BLINK) attributes += ';5';
  if (cell.flags & FLAG.STRIKETHROUGH) attributes += ';9';
  return `\x1b[${attributes};${colourSgr(foreground, '38')};${colourSgr(background, '48')}m`;
};

export class GhosttyScreen {
  constructor(exports, cols, rows) {
    this.exports = exports;
    this.cols = cols;
    this.rows = rows;
    this.handle = exports.ghostty_terminal_new(cols, rows);
    if (!this.handle) throw new Error('ghostty-vt could not create a terminal');
    this.graphemePointer = exports.ghostty_wasm_alloc_u8_array(GRAPHEME_CAPACITY * 4);
    this.alternate = false;
  }

  write(data) {
    const x = this.exports;
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    const pointer = x.ghostty_wasm_alloc_u8_array(bytes.length);
    try {
      new Uint8Array(x.memory.buffer).set(bytes, pointer);
      x.ghostty_terminal_write(this.handle, pointer, bytes.length);
    } finally {
      x.ghostty_wasm_free_u8_array(pointer, bytes.length);
    }
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.exports.ghostty_terminal_resize(this.handle, cols, rows);
  }

  readCells() {
    const x = this.exports;
    const count = this.cols * this.rows;
    const size = count * CELL_BYTES;
    x.ghostty_render_state_update(this.handle);
    const pointer = x.ghostty_wasm_alloc_u8_array(size);
    try {
      if (x.ghostty_render_state_get_viewport(this.handle, pointer, count) < 0) {
        throw new Error('ghostty-vt could not read the viewport');
      }
      const view = new DataView(x.memory.buffer, pointer, size);
      const bytes = new Uint8Array(x.memory.buffer, pointer, size);
      const cells = new Array(count);
      for (let index = 0; index < count; index++) {
        const at = index * CELL_BYTES;
        cells[index] = {
          codepoint: view.getUint32(at, true),
          fg: [bytes[at + 4], bytes[at + 5], bytes[at + 6]],
          bg: [bytes[at + 7], bytes[at + 8], bytes[at + 9]],
          flags: bytes[at + 10],
          width: bytes[at + 11],
          graphemeLength: bytes[at + 14],
        };
      }
      return cells;
    } finally {
      x.ghostty_wasm_free_u8_array(pointer, size);
    }
  }

  textOf(cell, row, column) {
    if (cell.graphemeLength > 0) {
      const count = this.exports.ghostty_render_state_get_grapheme(this.handle, row, column, this.graphemePointer, GRAPHEME_CAPACITY);
      if (count > 0) {
        const codes = new Uint32Array(this.exports.memory.buffer, this.graphemePointer, count);
        return Array.from(codes, (code) => (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '�' : String.fromCodePoint(code))).join('');
      }
    }
    if (cell.codepoint === 0 || cell.codepoint > 0x10ffff || (cell.codepoint >= 0xd800 && cell.codepoint <= 0xdfff)) return ' ';
    return String.fromCodePoint(cell.codepoint);
  }

  frame() {
    const x = this.exports;
    const cells = this.readCells();
    const alternate = x.ghostty_terminal_is_alternate_screen(this.handle) !== 0;
    const cursorX = x.ghostty_render_state_get_cursor_x(this.handle);
    const cursorY = x.ghostty_render_state_get_cursor_y(this.handle);
    const cursorVisible = x.ghostty_render_state_get_cursor_visible(this.handle) !== 0;
    const parts = [];
    if (alternate !== this.alternate) {
      parts.push(alternate ? '\x1b[?1049h' : '\x1b[?1049l');
      this.alternate = alternate;
    }
    parts.push('\x1b[?7l\x1b[?25l');
    let style = '';
    for (let row = 0; row < this.rows; row++) {
      parts.push(`\x1b[${row + 1};1H`);
      for (let column = 0; column < this.cols; column++) {
        const cell = cells[row * this.cols + column];
        if (cell.width === 0) continue;
        const sgr = sgrFor(cell);
        if (sgr !== style) {
          parts.push(sgr);
          style = sgr;
        }
        parts.push(this.textOf(cell, row, column));
      }
    }
    parts.push('\x1b[0m', `\x1b[${cursorY + 1};${cursorX + 1}H`, cursorVisible ? '\x1b[?25h' : '', '\x1b[?7h');
    return parts.join('');
  }

  free() {
    this.exports.ghostty_wasm_free_u8_array(this.graphemePointer, GRAPHEME_CAPACITY * 4);
    this.exports.ghostty_terminal_free(this.handle);
    this.handle = 0;
  }
}

export function ghosttyAdapter(term, screen) {
  const adapter = xtermAdapter(term);
  let scheduled = false;
  let resized = false;
  const paint = () => {
    scheduled = false;
    if (!screen.handle) return;
    screen.resize(term.cols, term.rows);
    const clear = resized ? '\x1b[2J' : '';
    resized = false;
    term.write(clear + screen.frame());
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(paint, 0);
  };
  term.onResize(({ cols, rows }) => {
    screen.resize(cols, rows);
    resized = true;
    schedule();
  });
  return {
    write(bytes) {
      screen.write(bytes);
      schedule();
    },
    onData: adapter.onData,
    onKeyData: adapter.onKeyData,
    onResize: adapter.onResize,
    get cols() { return adapter.cols; },
    get rows() { return adapter.rows; },
  };
}
