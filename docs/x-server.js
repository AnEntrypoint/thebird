const OPCODES = {
    CreateWindow: 1, ChangeWindowAttributes: 2, GetWindowAttributes: 3, DestroyWindow: 4,
    DestroySubwindows: 5, ChangeSaveSet: 6, ReparentWindow: 7, MapWindow: 8, MapSubwindows: 9,
    UnmapWindow: 10, UnmapSubwindows: 11, ConfigureWindow: 12, CirculateWindow: 13,
    GetGeometry: 14, QueryTree: 15, InternAtom: 16, GetAtomName: 17, ChangeProperty: 18,
    DeleteProperty: 19, GetProperty: 20, ListProperties: 21, SetSelectionOwner: 22,
    GetSelectionOwner: 23, ConvertSelection: 24, SendEvent: 25, GrabPointer: 26,
    UngrabPointer: 27, GrabButton: 28, UngrabButton: 29, GrabKeyboard: 31, UngrabKeyboard: 32,
    GrabKey: 33, UngrabKey: 34, AllowEvents: 35, GrabServer: 36, UngrabServer: 37,
    QueryPointer: 38, GetMotionEvents: 39, TranslateCoordinates: 40, WarpPointer: 41,
    SetInputFocus: 42, GetInputFocus: 43, OpenFont: 45, CloseFont: 46, QueryFont: 47,
    QueryTextExtents: 48, ListFonts: 49, CreatePixmap: 53, FreePixmap: 54, CreateGC: 55,
    ChangeGC: 56, CopyGC: 57, FreeGC: 60, ClearArea: 61, CopyArea: 62, PolyPoint: 64,
    PolyLine: 65, PolySegment: 66, PolyRectangle: 67, PolyArc: 68, FillPoly: 69,
    PolyFillRectangle: 70, PolyFillArc: 71, PutImage: 72, GetImage: 73, ImageText8: 76,
    ImageText16: 77, CreateColormap: 78, FreeColormap: 79, AllocColor: 84, AllocNamedColor: 85,
    QueryExtension: 98, ListExtensions: 99, GetKeyboardMapping: 101, GetModifierMapping: 119,
    NoOperation: 127,
    CreateCursor: 93, CreateGlyphCursor: 94, FreeCursor: 95, RecolorCursor: 96,
};

const EVENT_TYPES = {
    KeyPress: 2, KeyRelease: 3, ButtonPress: 4, ButtonRelease: 5, MotionNotify: 6,
    EnterNotify: 7, LeaveNotify: 8, FocusIn: 9, FocusOut: 10, KeymapNotify: 11,
    Expose: 12, GraphicsExposure: 13, NoExposure: 14, VisibilityNotify: 15,
    CreateNotify: 16, DestroyNotify: 17, UnmapNotify: 18, MapNotify: 19, MapRequest: 20,
    ReparentNotify: 21, ConfigureNotify: 22, ConfigureRequest: 23, GravityNotify: 24,
    ResizeRequest: 25, CirculateNotify: 26, CirculateRequest: 27, PropertyNotify: 28,
    SelectionClear: 29, SelectionRequest: 30, SelectionNotify: 31, ColormapNotify: 32,
    ClientMessage: 33, MappingNotify: 34,
};

const KEYSYMS = {
    'Enter': 0xff0d, 'Escape': 0xff1b, 'Tab': 0xff09, 'Backspace': 0xff08, 'Delete': 0xffff,
    'ArrowLeft': 0xff51, 'ArrowUp': 0xff52, 'ArrowRight': 0xff53, 'ArrowDown': 0xff54,
    'Home': 0xff50, 'End': 0xff57, 'PageUp': 0xff55, 'PageDown': 0xff56,
    'Shift': 0xffe1, 'Control': 0xffe3, 'Alt': 0xffe9, 'Meta': 0xffeb,
    'F1': 0xffbe, 'F2': 0xffbf, 'F3': 0xffc0, 'F4': 0xffc1, 'F5': 0xffc2,
    'F6': 0xffc3, 'F7': 0xffc4, 'F8': 0xffc5, 'F9': 0xffc6, 'F10': 0xffc7,
    'F11': 0xffc8, 'F12': 0xffc9, ' ': 0x0020,
};
function keyToKeysym(k) {
    if (KEYSYMS[k] !== undefined) return KEYSYMS[k];
    if (k && k.length === 1) return k.charCodeAt(0);
    return 0;
}

const PRE_ATOMS = [
    'PRIMARY', 'SECONDARY', 'ARC', 'ATOM', 'BITMAP', 'CARDINAL', 'COLORMAP', 'CURSOR',
    'CUT_BUFFER0', 'DRAWABLE', 'FONT', 'INTEGER', 'PIXMAP', 'POINT', 'RECTANGLE',
    'RESOURCE_MANAGER', 'RGB_COLOR_MAP', 'RGB_BEST_MAP', 'RGB_BLUE_MAP', 'RGB_DEFAULT_MAP',
    'RGB_GRAY_MAP', 'RGB_GREEN_MAP', 'RGB_RED_MAP', 'STRING', 'VISUALID', 'WINDOW',
    'WM_COMMAND', 'WM_HINTS', 'WM_CLIENT_MACHINE', 'WM_ICON_NAME', 'WM_ICON_SIZE',
    'WM_NAME', 'WM_NORMAL_HINTS', 'WM_SIZE_HINTS', 'WM_ZOOM_HINTS', 'MIN_SPACE',
    'NORM_SPACE', 'MAX_SPACE', 'END_SPACE', 'SUPERSCRIPT_X', 'SUPERSCRIPT_Y',
    'SUBSCRIPT_X', 'SUBSCRIPT_Y', 'UNDERLINE_POSITION', 'UNDERLINE_THICKNESS',
    'STRIKEOUT_ASCENT', 'STRIKEOUT_DESCENT', 'ITALIC_ANGLE', 'X_HEIGHT', 'QUAD_WIDTH',
    'WEIGHT', 'POINT_SIZE', 'RESOLUTION', 'COPYRIGHT', 'NOTICE', 'FONT_NAME',
    'FAMILY_NAME', 'FULL_NAME', 'CAP_HEIGHT', 'WM_CLASS', 'WM_TRANSIENT_FOR',
    'WM_PROTOCOLS', 'WM_DELETE_WINDOW', '_NET_WM_NAME', '_NET_WM_ICON', '_NET_WM_STATE',
    '_NET_WM_PID', 'UTF8_STRING',
];

function packColor(v) { const r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff; return `rgb(${r},${g},${b})`; }

const CURSOR_NAMES = {
    XC_arrow: 'default', XC_left_ptr: 'default', XC_xterm: 'text', XC_crosshair: 'crosshair',
    XC_hand1: 'pointer', XC_hand2: 'pointer', XC_watch: 'wait', XC_pirate: 'not-allowed',
    XC_sb_h_double_arrow: 'ew-resize', XC_sb_v_double_arrow: 'ns-resize',
    XC_top_left_corner: 'nw-resize', XC_top_right_corner: 'ne-resize',
    XC_bottom_left_corner: 'sw-resize', XC_bottom_right_corner: 'se-resize',
    XC_fleur: 'move', XC_question_arrow: 'help',
};

export function createXServer({ canvas, displayName = ':0' } = {}) {
    if (!canvas) throw new Error('createXServer: canvas required');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('createXServer: canvas 2d context unavailable');
    let nextId = 0x100;
    const windows = new Map();
    const gcs = new Map();
    const fonts = new Map();
    const pixmaps = new Map();
    const cursors = new Map();
    const atoms = new Map();
    const atomNames = new Map();
    const properties = new Map();
    const events = [];
    const listeners = new Set();
    let internCounter = 0;

    // All resource kinds (window/gc/font/pixmap/cursor) draw from one id space.
    // Allocate the next id that wraps at 0x7fffffff AND is not live in any map, so
    // a long-lived server can't hand out an id that still refers to a live resource.
    function allocId() {
        for (let tries = 0; tries < 10000; tries++) {
            nextId++;
            if (nextId > 0x7fffffff) nextId = 0x100;
            if (!windows.has(nextId) && !gcs.has(nextId) && !fonts.has(nextId) && !pixmaps.has(nextId) && !cursors.has(nextId)) return nextId;
        }
        throw new Error('X11 server: resource id space exhausted');
    }
    function nextWindowId() { return allocId(); }
    function nextGCId() { return allocId(); }
    function nextFontId() { return allocId(); }
    function nextPixmapId() { return allocId(); }
    function nextCursorId() { return allocId(); }
    function idInUse(id) { return id === root.id || windows.has(id) || gcs.has(id) || fonts.has(id) || pixmaps.has(id) || cursors.has(id); }
    function nextAtomId() { for (let tries = 0; tries < 0x7fffffff; tries++) { if (++internCounter > 0x7fffffff) internCounter = 0; if (!atoms.has(internCounter)) return internCounter; } throw new Error('X11 server: atom id space exhausted'); }

    for (const n of PRE_ATOMS) { const a = nextAtomId(); atoms.set(a, n); atomNames.set(n, a); }

    const root = { id: 0x001, parent: null, x: 0, y: 0, w: canvas.width, h: canvas.height, mapped: true, attrs: { backgroundPixel: 0x000000 }, children: [] };
    windows.set(root.id, root);

    const MAX_EVENTS = 1000;
    let eventsDropped = 0;
    function pushEvent(ev) {
        if (ev.type !== 'MissedEvents' && eventsDropped > 0) {
            events.push({ type: 'MissedEvents', count: eventsDropped });
            eventsDropped = 0;
        }
        if (events.length >= MAX_EVENTS) { events.shift(); eventsDropped++; }
        events.push(ev);
        for (const fn of listeners) { try { fn(ev); } catch (e) { console.error('x-server event listener error', e); } }
    }

    function paintWindow(w) {
        if (!w.mapped) return;
        const bg = packColor((w.attrs && w.attrs.backgroundPixel) || 0);
        ctx.fillStyle = bg;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        for (const c of w.children) paintWindow(c);
    }

    function repaint() {
        ctx.fillStyle = packColor(root.attrs.backgroundPixel);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (const c of root.children) paintWindow(c);
    }

    function exposeSiblingsOverlapping(w) {
        const p = windows.get(w.parent); if (!p) return;
        for (const s of p.children) {
            if (s.id === w.id || !s.mapped) continue;
            if (s.x < w.x + w.w && s.x + s.w > w.x && s.y < w.y + w.h && s.y + s.h > w.y) {
                pushEvent({ type: EVENT_TYPES.Expose, window: s.id, x: 0, y: 0, w: s.w, h: s.h });
            }
        }
    }

    function drawableCtx(drawable) {
        if (windows.has(drawable)) {
            const w = windows.get(drawable);
            return { ctx, ox: w.x, oy: w.y, w: w.w, h: w.h, isWindow: true, win: w };
        }
        if (pixmaps.has(drawable)) {
            const p = pixmaps.get(drawable);
            return { ctx: p.ctx, ox: 0, oy: 0, w: p.w, h: p.h, isWindow: false, pixmap: p };
        }
        return null;
    }

    function withDrawable(drawable, fn) {
        const d = drawableCtx(drawable); if (!d) return null;
        d.ctx.save();
        try {
            d.ctx.translate(d.ox, d.oy);
            d.ctx.beginPath(); d.ctx.rect(0, 0, d.w, d.h); d.ctx.clip();
            return fn(d.ctx, d);
        } finally {
            d.ctx.restore();
        }
    }

    function applyGC(targetCtx, gc) {
        targetCtx.fillStyle = packColor(gc.foreground || 0xffffff);
        targetCtx.strokeStyle = packColor(gc.foreground || 0xffffff);
        targetCtx.lineWidth = gc.lineWidth || 1;
        targetCtx.lineCap = gc.capStyle || 'butt';
        targetCtx.lineJoin = gc.joinStyle || 'miter';
        if (gc.lineStyle === 'OnOffDash' || gc.lineStyle === 'DoubleDash') targetCtx.setLineDash(gc.dashes || [4, 4]);
        else targetCtx.setLineDash([]);
        targetCtx.globalCompositeOperation = (gc.function === 'GXxor') ? 'xor' : 'source-over';
        const f = gc.font ? fonts.get(gc.font) : null;
        if (f) targetCtx.font = f.css;
        targetCtx.textBaseline = 'alphabetic';
    }

    function validDims(w, h) { return Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0 && w <= 16384 && h <= 16384; }
    function validList(arr, keys) { return Array.isArray(arr) && arr.every(o => o && keys.every(k => Number.isFinite(o[k]) && o[k] >= -32768 && o[k] <= 32767)); }

    let mouseX = 0, mouseY = 0;
    let focusWindow = root.id;

    const handlers = {
        [OPCODES.CreateWindow]: ({ wid, parent, x, y, w, h, attrs }) => {
            let p;
            if (parent === undefined || parent === null) p = root;
            else { p = windows.get(parent); if (!p) return { error: 'BadWindow' }; }
            if (x !== undefined && (!Number.isFinite(x) || x < -32768 || x > 32767)) return { error: 'BadMatch' };
            if (y !== undefined && (!Number.isFinite(y) || y < -32768 || y > 32767)) return { error: 'BadMatch' };
            if (wid !== undefined && wid !== null && idInUse(wid)) return { error: 'BadIDChoice' };
            if (!validDims(w, h)) return { error: 'BadMatch' };
            const win = { id: wid || nextWindowId(), parent: p.id, x, y, w, h, mapped: false, attrs: attrs || {}, children: [] };
            p.children.push(win);
            windows.set(win.id, win);
            pushEvent({ type: EVENT_TYPES.CreateNotify, window: win.id, parent: p.id });
            return { wid: win.id };
        },
        [OPCODES.ChangeWindowAttributes]: ({ wid, attrs }) => {
            const w = windows.get(wid); if (!w) return { error: 'BadWindow' };
            Object.assign(w.attrs, attrs);
            if (attrs && attrs.cursor && cursors.has(attrs.cursor)) {
                const c = cursors.get(attrs.cursor);
                if (canvas.style) canvas.style.cursor = c.css || 'default';
            }
            return { ok: true };
        },
        [OPCODES.GetWindowAttributes]: ({ wid }) => {
            const w = windows.get(wid); if (!w) return { error: 'BadWindow' };
            return { attrs: { ...w.attrs }, mapped: w.mapped };
        },
        [OPCODES.DestroyWindow]: ({ wid }) => {
            if (wid === root.id) return { error: 'BadWindow' };
            const w = windows.get(wid); if (!w) return { error: 'BadWindow' };
            const p = windows.get(w.parent);
            exposeSiblingsOverlapping(w);
            if (p) p.children = p.children.filter(c => c.id !== wid);
            const destroySubtree = (node) => {
                for (const child of node.children.slice()) destroySubtree(child);
                const prefix = node.id + ':'; for (const k of properties.keys()) if (k.startsWith(prefix)) properties.delete(k);
                windows.delete(node.id);
                pushEvent({ type: EVENT_TYPES.DestroyNotify, window: node.id });
            };
            destroySubtree(w);
            repaint(); return { ok: true };
        },
        [OPCODES.ReparentWindow]: ({ wid, parent }) => {
            const w = windows.get(wid);
            if (!w || wid === root.id) return { error: 'BadWindow' };
            const p = windows.get(parent);
            if (!p) return { error: 'BadWindow' };
            if (parent === wid) return { error: 'BadMatch' };
            for (let anc = p; anc; anc = windows.get(anc.parent)) {
                if (anc.id === wid) return { error: 'BadMatch' };
            }
            const oldP = windows.get(w.parent);
            if (oldP) oldP.children = oldP.children.filter(c => c.id !== wid);
            p.children.push(w);
            w.parent = p.id;
            repaint();
            pushEvent({ type: EVENT_TYPES.ReparentNotify, window: wid, parent: p.id });
            return { ok: true };
        },
        [OPCODES.MapWindow]: ({ wid }) => {
            const w = windows.get(wid); if (!w) return { error: 'BadWindow' };
            w.mapped = true; repaint();
            pushEvent({ type: EVENT_TYPES.MapNotify, window: wid });
            pushEvent({ type: EVENT_TYPES.Expose, window: wid, x: 0, y: 0, w: w.w, h: w.h });
            return { ok: true };
        },
        [OPCODES.UnmapWindow]: ({ wid }) => {
            const w = windows.get(wid); if (!w) return { error: 'BadWindow' };
            w.mapped = false;
            exposeSiblingsOverlapping(w);
            repaint();
            pushEvent({ type: EVENT_TYPES.UnmapNotify, window: wid });
            return { ok: true };
        },
        [OPCODES.ConfigureWindow]: ({ wid, x, y, w, h }) => {
            const win = windows.get(wid); if (!win) return { error: 'BadWindow' };
            if (x !== undefined && (!Number.isFinite(x) || x < -32768 || x > 32767)) return { error: 'BadMatch' };
            if (y !== undefined && (!Number.isFinite(y) || y < -32768 || y > 32767)) return { error: 'BadMatch' };
            if (w !== undefined && (!Number.isFinite(w) || w <= 0 || w > 16384)) return { error: 'BadMatch' };
            if (h !== undefined && (!Number.isFinite(h) || h <= 0 || h > 16384)) return { error: 'BadMatch' };
            if (x !== undefined) win.x = x; if (y !== undefined) win.y = y;
            if (w !== undefined) win.w = w; if (h !== undefined) win.h = h;
            repaint();
            pushEvent({ type: EVENT_TYPES.ConfigureNotify, window: wid, x: win.x, y: win.y, w: win.w, h: win.h });
            return { ok: true };
        },
        [OPCODES.GetGeometry]: ({ wid }) => {
            const w = windows.get(wid); if (w) return { x: w.x, y: w.y, width: w.w, height: w.h, root: root.id };
            const p = pixmaps.get(wid); if (p) return { x: 0, y: 0, width: p.w, height: p.h, root: root.id };
            return { error: 'BadDrawable' };
        },
        [OPCODES.QueryTree]: ({ wid }) => {
            const w = windows.get(wid); if (!w) return { error: 'BadWindow' };
            return { root: root.id, parent: w.parent, children: w.children.map(c => c.id) };
        },
        [OPCODES.InternAtom]: ({ name }) => {
            if (atomNames.has(name)) return { atom: atomNames.get(name) };
            const a = nextAtomId(); atoms.set(a, name); atomNames.set(name, a); return { atom: a };
        },
        [OPCODES.GetAtomName]: ({ atom }) => { if (!atoms.has(atom)) return { error: 'BadAtom' }; return { name: atoms.get(atom) }; },
        [OPCODES.ChangeProperty]: ({ wid, property, type, format, data }) => {
            if (typeof wid !== 'number') return { error: 'BadWindow' };
            if (!windows.has(wid) && !pixmaps.has(wid)) return { error: 'BadDrawable' };
            if (typeof property !== 'number' || !atoms.has(property)) return { error: 'BadAtom' };
            if (![8, 16, 32].includes(format)) return { error: 'BadMatch' };
            if (!atoms.has(type)) return { error: 'BadAtom' };
            if (data && !(Array.isArray(data) || typeof data === 'string' || data instanceof Uint8Array || data instanceof Uint8ClampedArray)) return { error: 'BadMatch' };
            if (data && data.length > 0x40000000) return { error: 'BadMatch' };
            const key = wid + ':' + property;
            properties.set(key, { type, format, data });
            pushEvent({ type: EVENT_TYPES.PropertyNotify, window: wid, atom: property });
            return { ok: true };
        },
        [OPCODES.DeleteProperty]: ({ wid, property }) => { if (typeof wid !== 'number') return { error: 'BadWindow' }; if (!windows.has(wid) && !pixmaps.has(wid)) return { error: 'BadDrawable' }; if (typeof property !== 'number' || !atoms.has(property)) return { error: 'BadAtom' }; properties.delete(wid + ':' + property); return { ok: true }; },
        [OPCODES.GetProperty]: ({ wid, property }) => { if (typeof wid !== 'number' || (!windows.has(wid) && !pixmaps.has(wid))) return { error: 'BadDrawable' }; if (typeof property !== 'number' || !atoms.has(property)) return { error: 'BadAtom' }; return properties.get(wid + ':' + property) || { type: null, format: null, data: null }; },
        [OPCODES.ListProperties]: ({ wid }) => {
            if (typeof wid !== 'number' || (!windows.has(wid) && !pixmaps.has(wid))) return { error: 'BadDrawable' };
            const prefix = wid + ':';
            const out = [];
            for (const k of properties.keys()) if (k.startsWith(prefix)) { const a = +k.slice(prefix.length); if (Number.isInteger(a) && a > 0 && a <= 0xffffffff) out.push(a); }
            return { atoms: out };
        },
        [OPCODES.OpenFont]: ({ name, fid }) => {
            if (fid !== undefined && fid !== null && idInUse(fid)) return { error: 'BadIDChoice' };
            const id = fid || nextFontId();
            const m = name.match(/^-[^-]+-([^-]+)-([^-]+)-([^-]+)-[^-]*-[^-]*-(\d+)/);
            const family = m ? m[1] : 'monospace';
            const weight = m && m[2] === 'bold' ? 'bold' : 'normal';
            const px = m ? parseInt(m[4], 10) || 12 : 12;
            fonts.set(id, { name, css: `${weight} ${px}px ${family}, monospace`, px });
            return { fid: id };
        },
        [OPCODES.CloseFont]: ({ fid }) => { fonts.delete(fid); return { ok: true }; },
        [OPCODES.ListFonts]: ({ pattern }) => ({ names: ['fixed', '6x13', '9x15', '-misc-fixed-medium-r-normal--14-100-100-100-c-70-iso10646-1'].filter(n => !pattern || pattern === '*' || n.includes(pattern.replace(/\*/g, ''))) }),
        [OPCODES.QueryTextExtents]: ({ fid, text }) => {
            const f = fonts.get(fid); if (!f) return { error: 'BadFont' };
            ctx.save(); ctx.font = f.css; const m = ctx.measureText(text); ctx.restore();
            return { width: Math.ceil(m.width), ascent: f.px, descent: 2 };
        },
        [OPCODES.CreatePixmap]: ({ pid, drawable, w, h, depth }) => {
            if (!validDims(w, h)) return { error: 'BadMatch' };
            if (typeof document === 'undefined') return { error: 'BadMatch' };
            if (pid !== undefined && pid !== null && idInUse(pid)) return { error: 'BadIDChoice' };
            const id = pid || nextPixmapId();
            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            const c2 = cv.getContext('2d'); c2.fillStyle = 'rgb(0,0,0)'; c2.fillRect(0, 0, w, h);
            pixmaps.set(id, { id, w, h, depth: depth || 24, canvas: cv, ctx: c2 });
            return { pid: id };
        },
        [OPCODES.FreePixmap]: ({ pid }) => { pixmaps.delete(pid); return { ok: true }; },
        [OPCODES.CreateGC]: ({ gid, drawable, attrs }) => {
            if (gid !== undefined && gid !== null && idInUse(gid)) return { error: 'BadIDChoice' };
            const id = gid || nextGCId();
            gcs.set(id, { drawable, foreground: 0xffffff, background: 0x000000, lineWidth: 1, capStyle: 'butt', joinStyle: 'miter', lineStyle: 'Solid', function: 'GXcopy', font: null, ...attrs });
            return { gid: id };
        },
        [OPCODES.ChangeGC]: ({ gid, attrs }) => {
            const g = gcs.get(gid); if (!g) return { error: 'BadGC' };
            Object.assign(g, attrs); return { ok: true };
        },
        [OPCODES.CopyGC]: ({ srcGid, dstGid }) => {
            const s = gcs.get(srcGid); const d = gcs.get(dstGid);
            if (!s || !d) return { error: 'BadGC' };
            Object.assign(d, { ...s }); return { ok: true };
        },
        [OPCODES.FreeGC]: ({ gid }) => { gcs.delete(gid); return { ok: true }; },
        [OPCODES.ClearArea]: ({ wid, x, y, w, h }) => {
            const win = windows.get(wid); if (!win) return { error: 'BadWindow' };
            if (!drawableCtx(wid)) return { error: 'BadDrawable' };
            if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: 'BadMatch' };
            if (w !== 0 && !Number.isFinite(w)) return { error: 'BadMatch' };
            if (h !== 0 && !Number.isFinite(h)) return { error: 'BadMatch' };
            const ww = (w === 0) ? win.w : w; const hh = (h === 0) ? win.h : h;
            withDrawable(wid, c => { c.fillStyle = packColor(win.attrs.backgroundPixel || 0); c.fillRect(x, y, ww, hh); });
            return { ok: true };
        },
        [OPCODES.CopyArea]: ({ srcWid, dstWid, gid, sx, sy, dx, dy, w, h }) => {
            const src = drawableCtx(srcWid); const dst = drawableCtx(dstWid);
            if (!src || !dst) return { error: 'BadDrawable' };
            if (!validDims(w, h)) return { error: 'BadMatch' };
            if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { error: 'BadMatch' };
            if (sx < 0 || sy < 0 || sx + w > src.w || sy + h > src.h) return { error: 'BadMatch' };
            if (dx < 0 || dy < 0 || dx + w > dst.w || dy + h > dst.h) return { error: 'BadMatch' };
            if (typeof document === 'undefined') return { error: 'BadMatch' };
            const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
            const sc = src.isWindow ? canvas : src.pixmap.canvas;
            tmp.getContext('2d').drawImage(sc, src.ox + sx, src.oy + sy, w, h, 0, 0, w, h);
            const dc = dst.isWindow ? ctx : dst.pixmap.ctx;
            dc.drawImage(tmp, dst.ox + dx, dst.oy + dy);
            return { ok: true };
        },
        [OPCODES.PolyLine]: ({ drawable, wid, gid, points }) => {
            if (!validList(points, ['x', 'y'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); c.beginPath(); points.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)); c.stroke(); });
            return { ok: true };
        },
        [OPCODES.PolySegment]: ({ drawable, wid, gid, segments }) => {
            if (!validList(segments, ['x1', 'y1', 'x2', 'y2'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); for (const s of segments) { c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); } });
            return { ok: true };
        },
        [OPCODES.PolyRectangle]: ({ drawable, wid, gid, rects }) => {
            if (!validList(rects, ['x', 'y', 'w', 'h'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); for (const r of rects) c.strokeRect(r.x, r.y, r.w, r.h); });
            return { ok: true };
        },
        [OPCODES.PolyFillRectangle]: ({ drawable, wid, gid, rects }) => {
            if (!validList(rects, ['x', 'y', 'w', 'h'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); for (const r of rects) c.fillRect(r.x, r.y, r.w, r.h); });
            return { ok: true };
        },
        [OPCODES.PolyArc]: ({ drawable, wid, gid, arcs }) => {
            if (!validList(arcs, ['x', 'y', 'w', 'h'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); for (const a of arcs) { c.beginPath(); c.ellipse(a.x + a.w/2, a.y + a.h/2, a.w/2, a.h/2, 0, (a.angle1||0)/64*Math.PI/180, ((a.angle1||0)+(a.angle2||23040))/64*Math.PI/180); c.stroke(); } });
            return { ok: true };
        },
        [OPCODES.PolyFillArc]: ({ drawable, wid, gid, arcs }) => {
            if (!validList(arcs, ['x', 'y', 'w', 'h'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); for (const a of arcs) { c.beginPath(); c.ellipse(a.x + a.w/2, a.y + a.h/2, a.w/2, a.h/2, 0, 0, 2*Math.PI); c.fill(); } });
            return { ok: true };
        },
        [OPCODES.FillPoly]: ({ drawable, wid, gid, points }) => {
            if (!validList(points, ['x', 'y'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); c.beginPath(); points.forEach((p, i) => i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)); c.closePath(); c.fill(); });
            return { ok: true };
        },
        [OPCODES.PolyPoint]: ({ drawable, wid, gid, points }) => {
            if (!validList(points, ['x', 'y'])) return { error: 'BadMatch' };
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); for (const p of points) c.fillRect(p.x, p.y, 1, 1); });
            return { ok: true };
        },
        [OPCODES.ImageText8]: ({ drawable, wid, gid, x, y, text }) => {
            const tgt = drawable || wid; const gc = gcs.get(gid); if (!gc) return { error: 'BadGC' }; if (!drawableCtx(tgt)) return { error: 'BadDrawable' };
            withDrawable(tgt, c => { applyGC(c, gc); if (gc.background !== undefined) { const m = c.measureText(text); const fpx = (gc.font && fonts.get(gc.font)) ? fonts.get(gc.font).px : 12; c.save(); c.fillStyle = packColor(gc.background); c.fillRect(x, y - fpx, m.width, fpx + 2); c.restore(); } c.fillStyle = packColor(gc.foreground || 0xffffff); c.fillText(text, x, y); });
            return { ok: true };
        },
        [OPCODES.ImageText16]: (a) => handlers[OPCODES.ImageText8](a),
        [OPCODES.PutImage]: ({ drawable, wid, gid, x, y, w, h, data, format }) => {
            const tgt = drawable || wid; const d = drawableCtx(tgt); if (!d) return { error: 'BadDrawable' };
            if (!validDims(w, h) || w <= 0 || h <= 0) return { error: 'BadMatch' };
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < -32768 || x > 32767 || y < -32768 || y > 32767) return { error: 'BadMatch' };
            if (!(data instanceof Uint8ClampedArray) && !(data instanceof Uint8Array) && !Array.isArray(data)) return { error: 'BadMatch' };
            withDrawable(tgt, c => {
                const img = c.createImageData(w, h);
                if (data instanceof Uint8ClampedArray || data instanceof Uint8Array) {
                    img.data.set(data.subarray(0, img.data.length));
                } else if (Array.isArray(data)) {
                    for (let i = 0; i < img.data.length && i < data.length; i++) img.data[i] = data[i];
                }
                c.putImageData(img, x, y);
            });
            return { ok: true };
        },
        [OPCODES.GetImage]: ({ drawable, x, y, w, h }) => {
            const d = drawableCtx(drawable); if (!d) return { error: 'BadDrawable' };
            if (!validDims(w, h)) return { error: 'BadMatch' };
            const sourceCanvas = d.isWindow ? canvas : d.pixmap.canvas;
            const sx = d.ox + x, sy = d.oy + y;
            if (typeof document === 'undefined') return { error: 'BadMatch' };
            const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
            tmp.getContext('2d').drawImage(sourceCanvas, sx, sy, w, h, 0, 0, w, h);
            const id = tmp.getContext('2d').getImageData(0, 0, w, h);
            return { width: w, height: h, depth: 24, data: id.data, format: 'ZPixmap' };
        },
        [OPCODES.CreateCursor]: ({ cid, source, mask, foreground, background, x, y }) => {
            if (cid !== undefined && cid !== null && idInUse(cid)) return { error: 'BadIDChoice' };
            const id = cid || nextCursorId();
            cursors.set(id, { id, css: 'default', foreground, background, source, mask });
            return { cid: id };
        },
        [OPCODES.CreateGlyphCursor]: ({ cid, sourceFont, maskFont, sourceChar, maskChar, foreground, background }) => {
            if (cid !== undefined && cid !== null && idInUse(cid)) return { error: 'BadIDChoice' };
            const id = cid || nextCursorId();
            const key = typeof sourceChar === 'string' && sourceChar.startsWith('XC_') ? sourceChar : ('XC_' + sourceChar);
            const css = CURSOR_NAMES[key] || 'default';
            cursors.set(id, { id, css, foreground, background });
            return { cid: id };
        },
        [OPCODES.FreeCursor]: ({ cid }) => { cursors.delete(cid); return { ok: true }; },
        [OPCODES.RecolorCursor]: ({ cid, foreground, background }) => {
            const c = cursors.get(cid); if (!c) return { error: 'BadCursor' };
            c.foreground = foreground; c.background = background; return { ok: true };
        },
        // STUB: always reports no extensions present (no X extensions are implemented)
        [OPCODES.QueryExtension]: ({ name }) => ({ present: false, major: 0, event: 0, error: 0 }),
        // STUB: returns empty extension list
        [OPCODES.ListExtensions]: () => ({ names: [] }),
        // STUB: returns empty keysym table (no keyboard mapping is modelled)
        [OPCODES.GetKeyboardMapping]: () => ({ keysyms: [] }),
        // STUB: returns empty modifier table
        [OPCODES.GetModifierMapping]: () => ({ keycodes: [] }),
        [OPCODES.NoOperation]: () => ({ ok: true }),
        // STUB: grab semantics are not supported in this X11 shim
        [OPCODES.GrabPointer]: () => ({ status: 'NotImplemented' }),
        [OPCODES.UngrabPointer]: () => ({ ok: true }),
        [OPCODES.GrabKeyboard]: () => ({ status: 'NotImplemented' }),
        [OPCODES.UngrabKeyboard]: () => ({ ok: true }),
        [OPCODES.SendEvent]: ({ event }) => { pushEvent(event); return { ok: true }; },
        [OPCODES.QueryPointer]: () => ({ x: mouseX, y: mouseY, sameScreen: true }),
        [OPCODES.SetInputFocus]: ({ focus }) => {
            const w = windows.get(focus);
            if (!w) return { error: 'BadWindow' };
            focusWindow = focus;
            return { ok: true };
        },
        [OPCODES.GetInputFocus]: () => ({ focus: focusWindow }),
        [OPCODES.AllocColor]: ({ red, green, blue }) => ({ pixel: ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff), red, green, blue }),
        [OPCODES.AllocNamedColor]: ({ name }) => {
            const named = { white: 0xffffff, black: 0x000000, red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00, cyan: 0x00ffff, magenta: 0xff00ff, gray: 0x808080, orange: 0xffa500 };
            const v = named[String(name).toLowerCase()] !== undefined ? named[String(name).toLowerCase()] : 0xffffff;
            return { pixel: v, red: (v>>16)&0xff, green: (v>>8)&0xff, blue: v&0xff };
        },
    };

    function request(opcode, args) {
        const fn = handlers[opcode];
        if (!fn) throw new Error('unknown opcode ' + opcode);
        return fn(args || {});
    }

    function nextEvent() { return events.shift() || null; }
    function pendingEvents() { return events.length; }
    function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    // Walk the window tree to find the topmost mapped window whose bounds contain (x, y).
    // Coordinates are stored flat (paintWindow draws w.x/w.y with no ctx.translate accumulation
    // across ancestors), so hit-testing mirrors that: no offset accumulation either.
    function hitTest(node, x, y) {
        if (!node.mapped) return null;
        for (let i = node.children.length - 1; i >= 0; i--) {
            const hit = hitTest(node.children[i], x, y);
            if (hit) return hit;
        }
        if (node === root) return root;
        if (x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h) return node;
        return null;
    }

    const handleDom = e => {
        const r = canvas.getBoundingClientRect();
        const x = Math.round((e.clientX || 0) - r.left), y = Math.round((e.clientY || 0) - r.top);
        if (e.type === 'pointermove' || e.type === 'pointerdown' || e.type === 'pointerup') { mouseX = x; mouseY = y; }
        const target = hitTest(root, x, y);
        const targetId = target ? target.id : root.id;
        const focusId = (focusWindow != null && windows.has(focusWindow)) ? focusWindow : root.id;
        if (e.type === 'pointerdown') pushEvent({ type: EVENT_TYPES.ButtonPress, window: targetId, x, y, button: e.button + 1 });
        else if (e.type === 'pointerup') pushEvent({ type: EVENT_TYPES.ButtonRelease, window: targetId, x, y, button: e.button + 1 });
        else if (e.type === 'pointermove') pushEvent({ type: EVENT_TYPES.MotionNotify, window: targetId, x, y });
        else if (e.type === 'keydown') pushEvent({ type: EVENT_TYPES.KeyPress, window: focusId, keycode: e.keyCode, key: e.key, keysym: keyToKeysym(e.key) });
        else if (e.type === 'keyup') pushEvent({ type: EVENT_TYPES.KeyRelease, window: focusId, keycode: e.keyCode, key: e.key, keysym: keyToKeysym(e.key) });
    };
    canvas.addEventListener('pointerdown', handleDom);
    canvas.addEventListener('pointerup', handleDom);
    canvas.addEventListener('pointermove', handleDom);
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', handleDom);
    canvas.addEventListener('keyup', handleDom);

    function resizeRoot(w, h) {
        if (!validDims(w, h) || w <= 0 || h <= 0) return { error: 'BadMatch' };
        w = Math.round(w); h = Math.round(h);
        if (w === root.w && h === root.h) return { ok: true, w, h };
        canvas.width = w; canvas.height = h;
        root.w = w; root.h = h;
        pushEvent({ type: EVENT_TYPES.ConfigureNotify, window: root.id, x: 0, y: 0, w, h });
        repaint();
        return { ok: true, w, h };
    }

    repaint();
    const display = {
        display: displayName, canvas, request, nextEvent, pendingEvents, onEvent, resizeRoot,
        OPCODES, EVENT_TYPES, root: root.id,
        _internal: { windows, gcs, pixmaps, cursors, atoms, atomNames, properties },
        dispose() { canvas.removeEventListener('pointerdown', handleDom); canvas.removeEventListener('pointerup', handleDom); canvas.removeEventListener('pointermove', handleDom); canvas.removeEventListener('keydown', handleDom); canvas.removeEventListener('keyup', handleDom); windows.clear(); gcs.clear(); fonts.clear(); pixmaps.clear(); cursors.clear(); atoms.clear(); atomNames.clear(); properties.clear(); events.length = 0; listeners.clear(); }
    };
    return display;
}

export { OPCODES as XOPCODES, EVENT_TYPES as XEVENTS, KEYSYMS as XKEYSYMS, PRE_ATOMS as XPREATOMS };
