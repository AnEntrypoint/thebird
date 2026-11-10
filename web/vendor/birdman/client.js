const pageWindow = globalThis.window ?? { location: globalThis.location, addEventListener: globalThis.addEventListener.bind(globalThis), removeEventListener: globalThis.removeEventListener.bind(globalThis), postMessage: (message) => globalThis.postMessage(message) };
const CHANNEL = 'birdman';
const HELLO_INTERVAL_MS = 200;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export class BirdmanError extends Error {
  constructor({ code, message }) {
    super(message);
    this.name = 'BirdmanError';
    this.code = code;
  }
}

export class BirdmanSession {
  constructor(client, sessionId) {
    this.client = client;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return this.client.send(method, params, this.sessionId);
  }

  on(method, listener) {
    return this.client.on(method, listener, this.sessionId);
  }

  detach() {
    return this.client.send('Target.detachFromTarget', { sessionId: this.sessionId });
  }
}

export class Birdman {
  #sequence = 0;
  #pending = new Map();
  #messageListeners = new Set();
  #stateListeners = new Set();
  #transports = new Set();
  #targetOrigin = pageWindow.location.origin === 'null' ? '*' : pageWindow.location.origin;

  ready = false;

  constructor() {
    pageWindow.addEventListener('message', this.#receive);
  }

  #post(kind, message) {
    pageWindow.postMessage({ channel: CHANNEL, direction: 'down', kind, message }, this.#targetOrigin);
  }

  #receive = (event) => {
    if (event.source !== pageWindow && event.source !== globalThis) return;
    const data = event.data;
    if (data?.channel !== CHANNEL || data.direction !== 'up') return;
    if (data.kind === 'message') {
      this.#route(data.message);
      return;
    }
    this.ready = data.kind === 'ready';
    if (!this.ready) this.#failPending(`Birdman connection ${data.kind}`);
    for (const listener of this.#stateListeners) listener(data.kind);
    if (data.kind === 'closed') for (const transport of this.#transports) transport.onclose?.();
  };

  #route(message) {
    const pending = this.#pending.get(message.id);
    if (pending) {
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new BirdmanError(message.error));
      else pending.resolve(message.result);
      return;
    }
    for (const transport of this.#transports) transport.onmessage?.(JSON.stringify(message));
    if (message.method) for (const listener of this.#messageListeners) listener(message);
  }

  #failPending(reason) {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const { reject } of pending) reject(new BirdmanError({ code: -32000, message: reason }));
  }

  whenReady(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
    if (this.ready) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const settle = (finish) => {
        clearInterval(hello);
        clearTimeout(timeout);
        stopListening();
        finish();
      };
      const stopListening = this.onStateChange((kind) => {
        if (kind === 'ready') settle(() => resolve(this));
      });
      const hello = setInterval(() => this.#post('hello'), HELLO_INTERVAL_MS);
      const timeout = setTimeout(
        () =>
          settle(() =>
            reject(
              new BirdmanError({
                code: -32000,
                message: 'The Birdman extension did not answer. Click its toolbar button on this tab.',
              }),
            ),
          ),
        timeoutMs,
      );
      this.#post('hello');
    });
  }

  send(method, params = {}, sessionId) {
    if (!this.ready) return Promise.reject(new BirdmanError({ code: -32000, message: 'Birdman is not connected' }));
    const id = `birdman-${(this.#sequence += 1)}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#post('message', { id, method, params, sessionId });
    });
  }

  on(method, listener, sessionId) {
    return this.onAny((message) => {
      if (message.method !== method) return;
      if (sessionId !== undefined && message.sessionId !== sessionId) return;
      listener(message.params, message.sessionId);
    });
  }

  onAny(listener) {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onStateChange(listener) {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  session(sessionId) {
    return new BirdmanSession(this, sessionId);
  }

  async targets() {
    return (await this.send('Target.getTargets')).targetInfos;
  }

  async open(url, options = {}) {
    return (await this.send('Target.createTarget', { url, ...options })).targetId;
  }

  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return this.session(sessionId);
  }

  close(targetId) {
    return this.send('Target.closeTarget', { targetId });
  }

  transport() {
    const transport = {
      onmessage: null,
      onclose: null,
      send: (text) => this.#post('message', JSON.parse(text)),
      close: () => this.#transports.delete(transport),
    };
    this.#transports.add(transport);
    return transport;
  }

  dispose() {
    pageWindow.removeEventListener('message', this.#receive);
    this.#failPending('Birdman client disposed');
    this.ready = false;
  }
}

export async function connect({ timeoutMs } = {}) {
  return new Birdman().whenReady(timeoutMs);
}
