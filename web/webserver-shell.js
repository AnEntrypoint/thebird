import sdk from '../sdk/browser/index.js';

const phoneMedia = matchMedia('(max-width: 700px)');
const shell = document.getElementById('webserver-shell') ?? document.createElement('aside');
shell.id = 'webserver-shell';
shell.className = 'thebird-webserver-shell';
shell.dataset.shell = 'webservers';
shell.dataset.layout = phoneMedia.matches ? 'phone' : 'desktop';
shell.dataset.collapsed = 'true';
shell.dataset.open = 'false';
shell.dataset.hmr = 'connecting';
if (!shell.isConnected) document.body.append(shell);

const toggle = document.createElement('button');
toggle.id = 'webserver-shell-toggle';
toggle.type = 'button';
toggle.textContent = '≡';
toggle.setAttribute('aria-label', 'Show webservers');
document.body.append(toggle);

const applyLayout = () => {
  const phone = shell.dataset.layout === 'phone';
  const open = shell.dataset.open === 'true';
  const collapsed = shell.dataset.collapsed === 'true';
  const root = document.documentElement;
  root.dataset.webserverShell = phone ? 'phone' : collapsed ? 'collapsed' : 'expanded';
  root.dataset.webserverShellOpen = phone && open ? 'true' : 'false';
  root.style.setProperty('--webserver-shell-width', phone ? '0px' : collapsed ? '2.5rem' : '17rem');
};

const toggleShell = () => {
  if (shell.dataset.layout === 'phone') shell.dataset.open = shell.dataset.open === 'true' ? 'false' : 'true';
  else shell.dataset.collapsed = shell.dataset.collapsed === 'true' ? 'false' : 'true';
  applyLayout();
};

const render = (registry) => {
  const servers = registry.servers ?? [];
  shell.dataset.count = String(servers.length);
  shell.dataset.hmr = 'live';
  shell.innerHTML = '<header class="webserver-shell-header"><strong>Webservers</strong><button data-shell-toggle aria-label="Show or hide webservers">≡</button></header><section data-webserver-list>' + servers.map((server) => '<article class="webserver-card" data-webserver-id="' + server.id + '" data-webserver-status="' + server.status + '" data-webserver-hmr="' + server.hmr + '"><img src="/sites/' + server.id + '/favicon.ico" alt="" width="24" height="24"><div><a href="/sites/' + server.id + '/">' + server.title + '</a><small>' + server.status + ' · HMR ' + server.hmr + '</small></div><a data-webserver-settings href="/sites/' + server.id + '/settings">Settings</a><span data-webserver-mcp>MCP</span></article>').join('') + '</section><footer data-webserver-prompts>Use node bin/thebird-webserver.js register &lt;id&gt;</footer>';
  shell.querySelector('[data-shell-toggle]')?.addEventListener('click', toggleShell);
};

applyLayout();
phoneMedia.addEventListener('change', (event) => {
  shell.dataset.layout = event.matches ? 'phone' : 'desktop';
  shell.dataset.open = 'false';
  applyLayout();
});
toggle.addEventListener('click', toggleShell);
const refresh = async () => render(await sdk.registry());
globalThis.THEBIRD_WEBSERVER_SHELL = { refresh, render, toggle: toggleShell };
sdk.events(async () => refresh());
refresh().catch((error) => { shell.dataset.hmr = 'failed'; console.error(error); });
export default { refresh, render, toggle: toggleShell };
