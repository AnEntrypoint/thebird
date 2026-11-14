export function createPageAsk() {
  let active = null;
  return (question) =>
    new Promise((resolve) => {
      active?.remove();
      const dialog = document.createElement('div');
      dialog.id = 'thebird-ask';
      const label = document.createElement('label');
      label.textContent = question || 'fx asks';
      const input = document.createElement('input');
      const send = document.createElement('button');
      send.type = 'button';
      send.textContent = 'Send';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = 'Skip';
      dialog.append(label, input, send, skip);
      const finish = (value) => {
        dialog.remove();
        active = null;
        resolve(value);
      };
      send.addEventListener('click', () => finish(input.value));
      skip.addEventListener('click', () => finish(''));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') finish(input.value);
        if (event.key === 'Escape') finish('');
      });
      active = dialog;
      document.body.append(dialog);
      input.focus();
    });
}
