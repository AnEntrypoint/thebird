// File primitives — matches upstream signatures.
//
// This module is a barrel: every component lives in a single-responsibility
// submodule under ./files/, and the public export surface here is unchanged
// — no consumer import needs to move.

import { fileGlyph, fmtFileSize, FileIcon, sortFiles } from './files/types.js';
import { FileRow, FileSkeleton } from './files/entries.js';
import { FileGrid } from './files/grid.js';
import { FileToolbar, RootsPicker, DropZone, UploadProgress, EmptyState, BreadcrumbPath, BulkBar } from './files/chrome.js';

export {
    fileGlyph, fmtFileSize, FileIcon, sortFiles,
    FileRow, FileSkeleton,
    FileGrid,
    FileToolbar, RootsPicker, DropZone, UploadProgress, EmptyState, BreadcrumbPath, BulkBar,
};
