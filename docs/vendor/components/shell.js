// Chrome: Topbar, Crumb, Side, Status, AppShell, plus primitives
// (Brand, Chip, Btn, Glyph, Heading, Lede). Pure factories — props in,
// webjsx vnode out. CSS in app-shell.css uses these class names.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./shell/, and the public export surface here is unchanged
// — no consumer import needs to move.

import { Brand, Chip, Btn, IconButton, Badge, Pill, Glyph, Heading, Lede, Dot, Rail } from './shell/atoms.js';
import { ICON_PATHS, iconMarkup, Icon } from './shell/icons.js';
import { Topbar, Crumb, Side, Status, AppShell } from './shell/app-shell.js';
import { WorkspaceShell, WorkspaceRail } from './shell/workspace-shell.js';

export {
    Brand, Chip, Btn, IconButton, Badge, Pill, Glyph, Heading, Lede, Dot, Rail,
    ICON_PATHS, iconMarkup, Icon,
    Topbar, Crumb, Side, Status, AppShell,
    WorkspaceShell, WorkspaceRail,
};
