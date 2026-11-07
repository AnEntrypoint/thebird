const ESC = '\u001b';
const BEL = '\u0007';
const MAX_PENDING = 256;

export class AnsiParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.pending = '';
    this.style = { fg: null, bg: null, bold: false, underline: false };
  }

  classes() {
    const { fg, bg, bold, underline } = this.style;
    return [fg === null ? null : `fg-${fg}`, bg === null ? null : `bg-${bg}`, bold ? 'bold' : null, underline ? 'underline' : null]
      .filter(Boolean)
      .join(' ');
  }

  apply(params) {
    const codes = params === '' ? [0] : params.split(';').map((code) => Number(code) || 0);
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k];
      if (code === 0) this.style = { fg: null, bg: null, bold: false, underline: false };
      else if (code === 1) this.style.bold = true;
      else if (code === 22) this.style.bold = false;
      else if (code === 4) this.style.underline = true;
      else if (code === 24) this.style.underline = false;
      else if (code >= 30 && code <= 37) this.style.fg = code - 30;
      else if (code >= 90 && code <= 97) this.style.fg = code - 90 + 8;
      else if (code === 39) this.style.fg = null;
      else if (code >= 40 && code <= 47) this.style.bg = code - 40;
      else if (code >= 100 && code <= 107) this.style.bg = code - 100 + 8;
      else if (code === 49) this.style.bg = null;
      else if ((code === 38 || code === 48) && codes[k + 1] === 5) {
        const index = codes[k + 2];
        if (code === 38) this.style.fg = index < 16 ? index : null;
        else this.style.bg = index < 16 ? index : null;
        k += 2;
      } else if ((code === 38 || code === 48) && codes[k + 1] === 2) k += 4;
    }
  }

  push(chunk) {
    const input = this.pending + chunk;
    this.pending = '';
    const segments = [];
    let text = '';
    const emit = () => {
      if (text) segments.push({ text, classes: this.classes() });
      text = '';
    };
    let i = 0;
    while (i < input.length) {
      if (input[i] !== ESC) {
        text += input[i++];
        continue;
      }
      if (i + 1 >= input.length) break;
      const kind = input[i + 1];
      if (kind === '[') {
        let j = i + 2;
        while (j < input.length && !(input.charCodeAt(j) >= 0x40 && input.charCodeAt(j) <= 0x7e)) j++;
        if (j >= input.length) break;
        if (input[j] === 'm') {
          emit();
          this.apply(input.slice(i + 2, j));
        }
        i = j + 1;
      } else if (kind === ']') {
        let j = i + 2;
        while (j < input.length && input[j] !== BEL && !(input[j] === ESC && input[j + 1] === '\\')) j++;
        if (j >= input.length) break;
        i = input[j] === BEL ? j + 1 : j + 2;
      } else if (kind === '(' || kind === ')') {
        if (i + 2 >= input.length) break;
        i += 3;
      } else {
        i += 2;
      }
    }
    if (i < input.length) {
      const rest = input.slice(i);
      if (rest.length <= MAX_PENDING) this.pending = rest;
    }
    emit();
    return segments;
  }
}
