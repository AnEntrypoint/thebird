const LOADING = 'loading Python...';

export function createSplash(root) {
  let effect = null;
  let run = 0;

  const stop = () => {
    effect?.destroy();
    effect = null;
  };
  const plain = (text) => {
    stop();
    root.dataset.mode = 'text';
    root.textContent = text;
    root.hidden = false;
  };

  return {
    async loading(text = LOADING) {
      const current = ++run;
      stop();
      const canvas = document.createElement('canvas');
      canvas.style.width = '240px';
      canvas.style.height = '20px';
      root.replaceChildren(canvas);
      root.dataset.mode = 'pending';
      root.hidden = false;
      try {
        const { createTextEffect } = await import('./vendor/tte-js/src/index.js');
        if (current !== run) return;
        effect = createTextEffect(canvas, { text, effect: 'laseretch', loop: true });
        root.dataset.mode = 'effect';
      } catch {
        if (current === run) plain(text);
      }
    },
    done() {
      run++;
      stop();
      root.replaceChildren();
      root.hidden = true;
      delete root.dataset.mode;
    },
    failed(message) {
      run++;
      plain(message);
    },
  };
}
