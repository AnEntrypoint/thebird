const waiting = new Map();
let nextId = 1;

export const requestTakeover = (kind, payload) => new Promise((ok) => {
  const id = nextId++;
  waiting.set(id, ok);
  postMessage({ takeover: { id, kind, ...payload } });
});

export const settleTakeover = ({ id, code }) => {
  const ok = waiting.get(id);
  waiting.delete(id);
  ok?.(code);
};
