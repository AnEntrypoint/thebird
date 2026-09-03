import { Icon } from '../../../components/shell.js';

export const ROUTES = [
    { path: 'projects',  label: 'projects',  glyph: Icon('square') },
    { path: 'home',      label: 'home',      glyph: Icon('page') },
    { path: 'chat',      label: 'chat',      glyph: Icon('forum') },
    { path: 'sessions',  label: 'sessions',  glyph: Icon('thread') },
    { path: 'agents',    label: 'agents',    glyph: Icon('members') },
    { path: 'analytics', label: 'analytics', glyph: Icon('activity') },
    { path: 'models',    label: 'models',    glyph: Icon('circle-dot') },
    { path: 'logs',      label: 'logs',      glyph: Icon('menu') },
    { path: 'cron',      label: 'cron',      glyph: Icon('circle') },
    { path: 'skills',    label: 'skills',    glyph: Icon('check') },
    { path: 'config',    label: 'config',    glyph: Icon('settings') },
    { path: 'env',       label: 'keys',      glyph: Icon('hash') },
    { path: 'tools',     label: 'tools',     glyph: Icon('more-horizontal') },
    { path: 'batch',     label: 'batch',     glyph: Icon('square') },
    { path: 'gateway',   label: 'gateway',   glyph: Icon('arrow-right') },
];

export const OS_ROUTE_DEFS = [
    { path: 'os-instances', label: 'instances', glyph: Icon('square') },
    { path: 'os-windows',   label: 'windows',   glyph: Icon('screen') },
    { path: 'os-x',         label: 'x-server',  glyph: Icon('x') },
    { path: 'os-fs',        label: 'fs',        glyph: Icon('page') },
];
