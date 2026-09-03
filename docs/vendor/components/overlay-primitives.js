// Overlay primitives — Tooltip, Popover, Dropdown + useLongPress, useFloating.
// Shared positioning (auto-flip + viewport clamp) in useFloating; consumed by
// all three. No inline styles except runtime left/top. CSS classes scoped to
// .ds-247420 (see editor-primitives.css).
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./overlay-primitives/, and the public export surface here is
// unchanged — no consumer import needs to move. `trapTab` and `useRovingMenu`
// are re-exported too: they are consumed cross-module (shell.js imports
// trapTab from this path) even though the components.js barrel does not
// forward them.

import { useFloating, useLongPress, withBusy, trapTab } from './overlay-primitives/floating.js';
import { Tooltip } from './overlay-primitives/tooltip.js';
import { Popover } from './overlay-primitives/popover.js';
import { useRovingMenu } from './overlay-primitives/roving-menu.js';
import { Dropdown, PermissionMenu, MenuButton } from './overlay-primitives/menus.js';
import { ApprovalPrompt } from './overlay-primitives/approval-prompt.js';
import { CommandPalette } from './overlay-primitives/command-palette.js';
import { EmojiPicker } from './overlay-primitives/emoji-picker.js';
import { SettingsPopover } from './overlay-primitives/settings-popover.js';
import { AuthModal } from './overlay-primitives/auth-modal.js';
import { BootOverlay, VideoLightbox } from './overlay-primitives/full-screen.js';
import { HoverCard } from './overlay-primitives/hover-card.js';
import { Menubar } from './overlay-primitives/menubar.js';

export {
    useFloating, useLongPress, withBusy, trapTab,
    Tooltip,
    Popover,
    useRovingMenu,
    Dropdown, PermissionMenu, MenuButton,
    ApprovalPrompt,
    CommandPalette,
    EmojiPicker,
    SettingsPopover,
    AuthModal,
    BootOverlay, VideoLightbox,
    HoverCard,
    Menubar,
};
