// Freddie page registry — REAL renderers (not stubs). Each page is a
// self-contained micro-app (see ./freddie/runtime.js) wired to freddie's
// gui-* plugin HTTP endpoints (/api/*). Consumers mount FREDDIE_PAGES[id]
// through their thin router; no per-page wiring needed downstream. This is
// the single maintenance point for freddie GUI per the dynamic-stack contract.
//
// This module is a barrel: every page lives in a single-responsibility
// submodule under ./freddie/, grouped by the surface it drives, and the
// public export surface here is unchanged — no consumer import needs to move.

import { getRecentPaths, saveRecentPath, skillLabel, renderChatMessages } from './freddie/helpers.js';
import { home, agents, analytics } from './freddie/pages-overview.js';
import { chat, voice } from './freddie/pages-chat.js';
import { sessions, projects, git } from './freddie/pages-workspace.js';
import { models, skills, plugins } from './freddie/pages-models.js';
import { config, env } from './freddie/pages-config.js';
import { cron, tools, batch } from './freddie/pages-runners.js';
import { gateway, chains, machines, health } from './freddie/pages-infra.js';
import { logs, debug } from './freddie/pages-telemetry.js';
import { terminal, files, auth, settings, themePage as theme, worktree, sessionTree, notifications } from './freddie/pages-missing.js';

// ---- registry --------------------------------------------------------------

export const FREDDIE_PAGES = {
    home, chat, voice, sessions, projects, agents, analytics,
    models, cron, skills, plugins, config, env, tools, batch, gateway, chains,
    machines, health, debug, logs, git,
    terminal, files, auth, settings, theme, worktree,
    'session-tree': sessionTree,
    notifications,
};

export {
    home, agents, analytics,
    chat, voice,
    sessions, projects, git,
    models, skills, plugins, config, env,
    cron, tools, batch,
    gateway, chains, machines, health,
    logs, debug,
};

export { skillLabel, getRecentPaths, saveRecentPath, renderChatMessages };
