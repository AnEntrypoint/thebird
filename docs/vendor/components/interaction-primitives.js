// Interaction primitives — pointer drag/drop + keyboard shortcuts.
// Pointer Events only (touch+mouse). Visuals via editor-primitives.css.
//
// This module is a barrel: every primitive lives in a single-responsibility
// submodule under ./interaction-primitives/, and the public export surface here
// is unchanged — no consumer import needs to move.

import { useDraggable, useNumberScrub, usePointerDrag, useDropTarget } from './interaction-primitives/pointer.js';
import { Reorderable } from './interaction-primitives/reorderable.js';
import { formatShortcut, useKeyboardShortcut, ShortcutHint, ShortcutList, useKeyboardShortcutHelp, ShortcutHelpDialog } from './interaction-primitives/shortcuts.js';
import { isMobileNow, onMobileChange } from './interaction-primitives/mobile.js';

export {
    useDraggable, useNumberScrub, usePointerDrag, useDropTarget,
    Reorderable,
    formatShortcut, useKeyboardShortcut, ShortcutHint, ShortcutList, useKeyboardShortcutHelp, ShortcutHelpDialog,
    isMobileNow, onMobileChange,
};
