const LOADING = 'loading Python...';
const FRAME_MS = 90;
const GLYPHS = {
  t: ['  #  ', '#####', '  #  ', '  #  ', '  #  ', '  ## '],
  h: ['#    ', '#    ', '#### ', '#   #', '#   #', '#   #'],
  e: [' ### ', '#   #', '#####', '#    ', '#   #', ' ### '],
  b: ['#    ', '#    ', '#### ', '#   #', '#   #', '#### '],
  i: ['  #  ', '     ', '  #  ', '  #  ', '  #  ', '  #  '],
  r: ['#### ', '#   #', '#    ', '#    ', '#    ', '#    '],
  d: ['    #', '    #', ' ####', '#   #', '#   #', ' ####'],
};
const LOGO = Array.from({ length: 6 }, (_, row) => [...'thebird'].map((letter) => GLYPHS[letter][row]).join(' '));
const WIDTH = LOGO[0].length;

export function frameAt(tick) {
  const column = tick % WIDTH;
  return LOGO.map((line) => [...line].map((cell, index) => (cell === '#' && index === column ? '@' : cell)).join('')).join('\n');
}

export function createSplash(root) {
  let timer = null;
  let tick = 0;
  let pre = null;

  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const draw = () => {
    pre.textContent = frameAt(tick++);
  };
  const plain = (text) => {
    stop();
    root.dataset.mode = 'text';
    root.textContent = text;
    root.hidden = false;
  };

  return {
    loading(text = LOADING) {
      stop();
      pre = document.createElement('pre');
      const phase = document.createElement('span');
      phase.className = 'phase';
      phase.textContent = text;
      const logo = document.createElement('div');
      logo.className = 'logo';
      logo.append(pre, phase);
      root.replaceChildren(logo);
      root.dataset.mode = 'ascii';
      root.hidden = false;
      draw();
      timer = setInterval(draw, FRAME_MS);
    },
    done() {
      stop();
      root.replaceChildren();
      root.hidden = true;
      delete root.dataset.mode;
    },
    failed(message) {
      plain(message);
    },
  };
}
