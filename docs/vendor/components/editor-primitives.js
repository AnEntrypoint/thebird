// Editor primitives — generic chrome for in-engine editors, inspectors,
// IDEs, debug HUDs. Pure factories, h-based, theme-token driven. All
// visuals route through CSS classes defined in editor-primitives.css;
// no hex/rgba literals appear in this file. Theme switching happens
// via the kit's data-theme attribute on the .ds-247420 scope root.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./editor-primitives/, and the public export surface here is
// unchanged — no consumer import needs to move.

import { Toolbar, ToolbarRow, Tabs, IconButtonGroup } from './editor-primitives/chrome.js';
import { TreeView, TreeItem } from './editor-primitives/tree.js';
import { PropertyGrid, PropertyField, PropertyGridRow, InlineEditableField } from './editor-primitives/property-grid.js';
import { Dock, BP_SM, BP_MD, BP_LG, BP_XL, useMediaQuery, Grid, GridItem, Divider, AspectRatio } from './editor-primitives/layout.js';
import { ResizeHandle, SplitPanel } from './editor-primitives/split-panel.js';
import { Collapse, CollapseGroup } from './editor-primitives/collapse.js';
import { FocusTrap } from './editor-primitives/focus-trap.js';
import { ContextMenu, useContextMenu } from './editor-primitives/context-menu.js';
import { Drawer, Dialog } from './editor-primitives/modals.js';
import { Toast, toast } from './editor-primitives/toast.js';
import { Pager } from './editor-primitives/pager.js';
import { JsonViewer } from './editor-primitives/json-viewer.js';
import { InfoRow, InfoSection, DiagnosticsPanel } from './editor-primitives/diagnostics.js';
import { BatchProgressLabel, formatBatchOutcome, runBatchSequential } from './editor-primitives/batch.js';

export {
    Toolbar, ToolbarRow, Tabs, IconButtonGroup,
    TreeView, TreeItem,
    PropertyGrid, PropertyField, PropertyGridRow, InlineEditableField,
    Dock, BP_SM, BP_MD, BP_LG, BP_XL, useMediaQuery, Grid, GridItem, Divider, AspectRatio,
    ResizeHandle, SplitPanel,
    Collapse, CollapseGroup,
    FocusTrap,
    ContextMenu, useContextMenu,
    Drawer, Dialog,
    Toast, toast,
    Pager,
    JsonViewer,
    InfoRow, InfoSection, DiagnosticsPanel,
    BatchProgressLabel, formatBatchOutcome, runBatchSequential,
};
