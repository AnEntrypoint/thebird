// File modals — matches upstream signatures + class names.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./files-modals/, and the public export surface here is
// unchanged — no consumer import needs to move.

import { ConfirmDialog, PromptDialog, CountdownDialog } from './files-modals/dialogs.js';
import { FilePreviewMedia, FilePreviewCode, FilePreviewText } from './files-modals/preview-bodies.js';
import { FileViewer, FilePreviewPane } from './files-modals/preview-containers.js';
import { Modal, modalError } from './files-modals/modal-shell.js';

export {
    ConfirmDialog, PromptDialog, CountdownDialog,
    FilePreviewMedia, FilePreviewCode, FilePreviewText,
    FileViewer, FilePreviewPane,
    Modal, modalError,
};
