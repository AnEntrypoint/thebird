// context-pane barrel — thin barrel over ./context-pane/*.js. ContextPane's
// public export name/shape is unchanged for existing consumers; ContextMeter,
// ContextTreemap (+ its squarify layout helper) and ContextXRayPanel are new
// additions living in their own single-responsibility submodules alongside
// it, split out purely to respect the 200-line module cap.

import { ContextPane } from './context-pane/pane.js';
import { ContextMeter } from './context-pane/meter.js';
import { ContextTreemap, squarify } from './context-pane/treemap.js';
import { ContextXRayPanel } from './context-pane/xray.js';

export { ContextPane, ContextMeter, ContextTreemap, squarify, ContextXRayPanel };
