export { icons } from './icons.js';
export { createDesktopShell } from './shell.js';
export { renderWindow } from './wm.js';
export { renderDock } from './launcher.js';

// App modules — surfaced through the kit entry point so consumers can use a
// single import site. Each module also remains importable from its own path
// for tree-shaking and back-compat.
export { renderAboutApp } from './about-app.js';
export { renderBrowserPane } from './browser-app.js';
export { renderFilesApp } from './files-app.js';
export { renderMonitorApp } from './monitor-app.js';
export { renderTerminal } from './terminal-app.js';
export { createFreddieDashboard } from './freddie-dashboard.js';

export const themeUrl = new URL('./theme.css', import.meta.url).href;
