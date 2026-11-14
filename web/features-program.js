const requests = [
  {
    op: 'register',
    id: 'txiki-visible-demo',
    source: 'txiki',
    spec: {
      title: 'txiki.js programmed card',
      description: 'This card was registered by a program running in the txiki.js browser engine.',
      status: 'registered through __thebirdBridge',
      body: [
        { type: 'p', text: 'txiki.js can program visible thebird features.' },
        { type: 'button', id: 'txiki-demo-button', label: 'txiki ready' }
      ]
    }
  }
];

const manifestUrl = new URL('./features.json', globalThis.__thebirdModuleUrl ?? location.href).href;
const response = await fetch(manifestUrl);
if (!response.ok) throw new Error(`features.json returned ${response.status}`);
const manifest = await response.json();
console.log(`feature api v${manifest.version} ${manifest.api}`);
const bridgeWaiting = new Map();
let bridgeLast = 0;

__thebirdBridge.onResult = (event) => {
  const settle = bridgeWaiting.get(event.id);
  bridgeWaiting.delete(event.id);
  settle?.(event);
};

const send = (message) => new Promise((settle) => {
  const id = ++bridgeLast;
  bridgeWaiting.set(id, settle);
  __thebirdBridge.send(JSON.stringify({ op: 'builtin', id, name: 'feature', argv: [JSON.stringify(message)], cwd: '/workspace' }));
});

for (const request of requests) {
  const result = await send(request);
  console.log(`${request.id}: ${result.code === 0 ? 'registered' : result.err.trim()}`);
}
