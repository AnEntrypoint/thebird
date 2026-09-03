import { XOPCODES, XEVENTS, XKEYSYMS, XPREATOMS } from './x-server.js';

export function createXClient(display) {
    if (!display || typeof display.request !== 'function') throw new Error('createXClient: display required');

    // Honest interface: the server returns { error: 'BadDrawable' | 'BadGC' | ... }
    // for failed requests. Silently returning that object to the caller as if it
    // were a success masks the failure (a confused caller draws into the void and
    // never knows). Surface server errors as thrown exceptions so misuse is loud.
    const checked = (r, op) => {
        if (r && typeof r === 'object' && r.error) throw new Error('X11 ' + op + ': ' + r.error);
        return r;
    };

    const X = {
        display,
        EVENTS: XEVENTS,
        OPCODES: XOPCODES,
        KEYSYMS: XKEYSYMS,
        rootWindow() { return display.root; },
        createSimpleWindow(parent, x, y, w, h, attrs = {}) {
            const r = checked(display.request(XOPCODES.CreateWindow, { parent, x, y, w, h, attrs }), 'CreateWindow');
            return r.wid;
        },
        mapWindow(wid) { return checked(display.request(XOPCODES.MapWindow, { wid }), 'MapWindow'); },
        unmapWindow(wid) { return checked(display.request(XOPCODES.UnmapWindow, { wid }), 'UnmapWindow'); },
        destroyWindow(wid) { return checked(display.request(XOPCODES.DestroyWindow, { wid }), 'DestroyWindow'); },
        configureWindow(wid, opts) { return checked(display.request(XOPCODES.ConfigureWindow, { wid, ...opts }), 'ConfigureWindow'); },
        getGeometry(wid) { return checked(display.request(XOPCODES.GetGeometry, { wid }), 'GetGeometry'); },
        queryTree(wid) { return checked(display.request(XOPCODES.QueryTree, { wid }), 'QueryTree'); },
        changeWindowAttributes(wid, attrs) { return checked(display.request(XOPCODES.ChangeWindowAttributes, { wid, attrs }), 'ChangeWindowAttributes'); },
        clearArea(wid, x = 0, y = 0, w = 0, h = 0) { return checked(display.request(XOPCODES.ClearArea, { wid, x, y, w, h }), 'ClearArea'); },
        copyArea(srcWid, dstWid, gid, sx, sy, dx, dy, w, h) { return checked(display.request(XOPCODES.CopyArea, { srcWid, dstWid, gid, sx, sy, dx, dy, w, h }), 'CopyArea'); },

        createPixmap(drawable, w, h, depth = 24) { return checked(display.request(XOPCODES.CreatePixmap, { drawable, w, h, depth }), 'CreatePixmap').pid; },
        freePixmap(pid) { return checked(display.request(XOPCODES.FreePixmap, { pid }), 'FreePixmap'); },

        createGC(drawable, attrs = {}) { return checked(display.request(XOPCODES.CreateGC, { drawable, attrs }), 'CreateGC').gid; },
        changeGC(gid, attrs) { return checked(display.request(XOPCODES.ChangeGC, { gid, attrs }), 'ChangeGC'); },
        copyGC(srcGid, dstGid) { return checked(display.request(XOPCODES.CopyGC, { srcGid, dstGid }), 'CopyGC'); },
        freeGC(gid) { return checked(display.request(XOPCODES.FreeGC, { gid }), 'FreeGC'); },

        openFont(name) { return checked(display.request(XOPCODES.OpenFont, { name }), 'OpenFont').fid; },
        closeFont(fid) { return checked(display.request(XOPCODES.CloseFont, { fid }), 'CloseFont'); },
        listFonts(pattern = '*') { return checked(display.request(XOPCODES.ListFonts, { pattern }), 'ListFonts').names; },
        queryTextExtents(fid, text) { return checked(display.request(XOPCODES.QueryTextExtents, { fid, text }), 'QueryTextExtents'); },

        polyLine(wid, gid, points) { return checked(display.request(XOPCODES.PolyLine, { wid, gid, points }), 'PolyLine'); },
        polySegment(wid, gid, segments) { return checked(display.request(XOPCODES.PolySegment, { wid, gid, segments }), 'PolySegment'); },
        polyRectangle(wid, gid, rects) { return checked(display.request(XOPCODES.PolyRectangle, { wid, gid, rects }), 'PolyRectangle'); },
        polyArc(wid, gid, arcs) { return checked(display.request(XOPCODES.PolyArc, { wid, gid, arcs }), 'PolyArc'); },
        polyFillRectangle(wid, gid, rects) { return checked(display.request(XOPCODES.PolyFillRectangle, { wid, gid, rects }), 'PolyFillRectangle'); },
        polyFillArc(wid, gid, arcs) { return checked(display.request(XOPCODES.PolyFillArc, { wid, gid, arcs }), 'PolyFillArc'); },
        fillPoly(wid, gid, points) { return checked(display.request(XOPCODES.FillPoly, { wid, gid, points }), 'FillPoly'); },
        polyPoint(wid, gid, points) { return checked(display.request(XOPCODES.PolyPoint, { wid, gid, points }), 'PolyPoint'); },
        imageText8(wid, gid, x, y, text) { return checked(display.request(XOPCODES.ImageText8, { wid, gid, x, y, text }), 'ImageText8'); },
        imageText16(wid, gid, x, y, text) { return checked(display.request(XOPCODES.ImageText16, { wid, gid, x, y, text }), 'ImageText16'); },
        putImage(drawable, gid, x, y, w, h, data) { return checked(display.request(XOPCODES.PutImage, { drawable, gid, x, y, w, h, data, format: 'ZPixmap' }), 'PutImage'); },
        getImage(drawable, x, y, w, h) { return checked(display.request(XOPCODES.GetImage, { drawable, x, y, w, h }), 'GetImage'); },

        createGlyphCursor(name) { return checked(display.request(XOPCODES.CreateGlyphCursor, { sourceChar: name, foreground: 0xffffff, background: 0x000000 }), 'CreateGlyphCursor').cid; },
        freeCursor(cid) { return checked(display.request(XOPCODES.FreeCursor, { cid }), 'FreeCursor'); },
        defineCursor(wid, cid) { return checked(display.request(XOPCODES.ChangeWindowAttributes, { wid, attrs: { cursor: cid } }), 'ChangeWindowAttributes'); },

        internAtom(name) { return checked(display.request(XOPCODES.InternAtom, { name }), 'InternAtom').atom; },
        getAtomName(atom) { return checked(display.request(XOPCODES.GetAtomName, { atom }), 'GetAtomName').name; },
        changeProperty(wid, property, type, format, data) { return checked(display.request(XOPCODES.ChangeProperty, { wid, property, type, format, data }), 'ChangeProperty'); },
        deleteProperty(wid, property) { return checked(display.request(XOPCODES.DeleteProperty, { wid, property }), 'DeleteProperty'); },
        getProperty(wid, property) { return checked(display.request(XOPCODES.GetProperty, { wid, property }), 'GetProperty'); },
        listProperties(wid) { return checked(display.request(XOPCODES.ListProperties, { wid }), 'ListProperties').atoms; },

        setWMName(wid, name) {
            const a = X.internAtom('WM_NAME');
            return X.changeProperty(wid, a, X.internAtom('STRING'), 8, name);
        },
        setWMClass(wid, instance, klass) {
            const a = X.internAtom('WM_CLASS');
            return X.changeProperty(wid, a, X.internAtom('STRING'), 8, instance + '\0' + klass);
        },
        setWMProtocols(wid, protos) {
            const a = X.internAtom('WM_PROTOCOLS');
            return X.changeProperty(wid, a, X.internAtom('ATOM'), 32, protos.map(n => X.internAtom(n)));
        },

        sendEvent(event) { return checked(display.request(XOPCODES.SendEvent, { event }), 'SendEvent'); },
        grabPointer() { return checked(display.request(XOPCODES.GrabPointer, {}), 'GrabPointer'); },
        ungrabPointer() { return checked(display.request(XOPCODES.UngrabPointer, {}), 'UngrabPointer'); },
        queryPointer() { return checked(display.request(XOPCODES.QueryPointer, {}), 'QueryPointer'); },
        setInputFocus(wid) { return checked(display.request(XOPCODES.SetInputFocus, { focus: wid }), 'SetInputFocus'); },
        getInputFocus() { return checked(display.request(XOPCODES.GetInputFocus, {}), 'GetInputFocus'); },
        allocColor(red, green, blue) { return checked(display.request(XOPCODES.AllocColor, { red, green, blue }), 'AllocColor'); },
        allocNamedColor(name) { return checked(display.request(XOPCODES.AllocNamedColor, { name }), 'AllocNamedColor'); },

        nextEvent() { return display.nextEvent(); },
        pending() { return display.pendingEvents(); },
        onEvent(fn) { return display.onEvent(fn); },
        flush() { },
    };
    return X;
}

export const X_PROGRAMS = {
    xhello(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 40, 40, 320, 80, { backgroundPixel: 0x202830 });
        X.setWMName(win, 'xhello');
        X.setWMClass(win, 'xhello', 'Demo');
        X.mapWindow(win);
        const fid = X.openFont('-misc-fixed-medium-r-normal--16-100-100-100-c-70-iso10646-1');
        const gc = X.createGC(win, { foreground: 0x79e872, background: 0x202830, font: fid });
        X.imageText8(win, gc, 12, 28, 'hello, x server');
        X.imageText8(win, gc, 12, 52, 'rendered via opcode dispatch');
        return { window: win, gc, font: fid };
    },
    xclock(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 380, 40, 160, 160, { backgroundPixel: 0x14181d });
        X.setWMName(win, 'xclock');
        X.setWMProtocols(win, ['WM_DELETE_WINDOW']);
        X.mapWindow(win);
        const gc = X.createGC(win, { foreground: 0x3FA93A, lineWidth: 2 });
        const gcBg = X.createGC(win, { foreground: 0x14181d });
        const r = 70, cx = 80, cy = 80;

        function drawFace() {
            X.polyFillRectangle(win, gcBg, [{ x: 0, y: 0, w: 160, h: 160 }]);
            X.polyArc(win, gc, [{ x: cx - r, y: cy - r, w: r*2, h: r*2 }]);
            for (let h = 0; h < 12; h++) {
                const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
                X.polySegment(win, gc, [{ x1: cx + Math.cos(a)*(r-8), y1: cy + Math.sin(a)*(r-8), x2: cx + Math.cos(a)*r, y2: cy + Math.sin(a)*r }]);
            }
        }

        function drawHands() {
            const now = new Date();
            const hAng = ((now.getHours() % 12) / 12 + now.getMinutes() / 720) * Math.PI * 2 - Math.PI / 2;
            const mAng = ((now.getMinutes() + now.getSeconds() / 60) / 60) * Math.PI * 2 - Math.PI / 2;
            X.polySegment(win, gc, [{ x1: cx, y1: cy, x2: cx + Math.cos(hAng)*(r-24), y2: cy + Math.sin(hAng)*(r-24) }]);
            X.polySegment(win, gc, [{ x1: cx, y1: cy, x2: cx + Math.cos(mAng)*(r-12), y2: cy + Math.sin(mAng)*(r-12) }]);
        }

        function stop() {
            clearInterval(timer);
            unsub();
        }
        function tick() {
            try {
                drawFace();
                drawHands();
            } catch (e) {
                // Window is gone but no DestroyNotify ever reached us (WM/server
                // tore it down through a non-standard path) -- stop leaking the
                // timer instead of redrawing into a dead window forever.
                stop();
            }
        }
        tick();
        const timer = setInterval(tick, 1000);
        const unsub = X.onEvent(ev => {
            if (ev.window !== win) return;
            if (ev.type === X.EVENTS.DestroyNotify) {
                stop();
            }
        });

        return { window: win, gc, gcBg };
    },
    xeyes(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 220, 200, 200, 100, { backgroundPixel: 0x14181d });
        X.setWMName(win, 'xeyes');
        X.mapWindow(win);
        const gBg = X.createGC(win, { foreground: 0x14181d });
        const gWhite = X.createGC(win, { foreground: 0xeeeeee });
        const gBlack = X.createGC(win, { foreground: 0x000000 });
        const eyes = [{ cx: 50, cy: 50 }, { cx: 150, cy: 50 }];
        const eyeR = 40, pupilR = 12, travel = eyeR - pupilR - 4;

        function drawPupils(px, py) {
            X.polyFillRectangle(win, gBg, [{ x: 0, y: 0, w: 200, h: 100 }]);
            X.polyFillArc(win, gWhite, eyes.map(e => ({ x: e.cx - eyeR, y: e.cy - eyeR, w: eyeR * 2, h: eyeR * 2 })));
            const pupils = eyes.map(e => {
                let dx = px - e.cx, dy = py - e.cy;
                const dist = Math.hypot(dx, dy) || 1;
                const clamped = Math.min(dist, travel) / dist;
                dx *= clamped; dy *= clamped;
                return { x: e.cx + dx - pupilR, y: e.cy + dy - pupilR, w: pupilR * 2, h: pupilR * 2 };
            });
            X.polyFillArc(win, gBlack, pupils);
        }
        drawPupils(-10000, -10000);

        const unsub = X.onEvent(ev => {
            if (ev.window !== win) return;
            if (ev.type === X.EVENTS.MotionNotify) {
                drawPupils(ev.x, ev.y);
            } else if (ev.type === X.EVENTS.DestroyNotify && ev.window === win) {
                unsub();
            }
        });

        return { window: win, gcBg: gBg, gcWhite: gWhite, gcBlack: gBlack, drawPupils };
    },
    xcalc(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 60, 240, 180, 220, { backgroundPixel: 0x202020 });
        X.setWMName(win, 'xcalc');
        X.setWMProtocols(win, ['WM_DELETE_WINDOW']);
        X.mapWindow(win);
        const fid = X.openFont('-misc-fixed-medium-r-normal--14-100-100-100-c-70-iso10646-1');
        const gcLcd = X.createGC(win, { foreground: 0x79e872, background: 0x000000, font: fid });
        const gcKey = X.createGC(win, { foreground: 0xeeeeee, background: 0x404040, font: fid });
        const gcLcdBg = X.createGC(win, { foreground: 0x000000 });
        const gcKeyBg = X.createGC(win, { foreground: 0x404040 });
        const lcdRect = { x: 8, y: 8, w: 164, h: 28 };
        const labels = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];
        const keyRects = labels.map((label, i) => ({
            label,
            x: 8 + (i % 4) * 42,
            y: 44 + Math.floor(i / 4) * 42,
            w: 38, h: 38,
        }));

        let display = '0';
        let acc = null;
        let pendingOp = null;

        function redrawLcd() {
            X.polyFillRectangle(win, gcLcdBg, [lcdRect]);
            X.imageText8(win, gcLcd, 12, 28, display.slice(-16));
        }
        redrawLcd();
        for (const k of keyRects) {
            X.polyFillRectangle(win, gcKeyBg, [{ x: k.x, y: k.y, w: k.w, h: k.h }]);
            X.imageText8(win, gcKey, k.x + 14, k.y + 24, k.label);
        }

        function hitKey(x, y) {
            return keyRects.find(k => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) || null;
        }

        function applyPending() {
            const cur = parseFloat(display) || 0;
            if (pendingOp && acc !== null) {
                if (pendingOp === '+') acc += cur;
                else if (pendingOp === '-') acc -= cur;
                else if (pendingOp === '*') acc *= cur;
                else if (pendingOp === '/') acc = cur === 0 ? NaN : acc / cur;
            } else {
                acc = cur;
            }
        }

        function press(label) {
            if (label >= '0' && label <= '9') {
                display = display === '0' ? label : display + label;
            } else if (label === '.') {
                if (!display.includes('.')) display += '.';
            } else if (label === '=') {
                applyPending();
                display = String(acc);
                pendingOp = null;
                acc = null;
            } else {
                applyPending();
                pendingOp = label;
                display = '0';
            }
            redrawLcd();
        }

        const unsub = X.onEvent(ev => {
            if (ev.window !== win) return;
            if (ev.type === X.EVENTS.ButtonPress) {
                const k = hitKey(ev.x, ev.y);
                if (k) press(k.label);
            } else if (ev.type === X.EVENTS.KeyPress && ev.key) {
                if (/^[0-9.]$/.test(ev.key) || ['+','-','*','/','='].includes(ev.key)) press(ev.key);
                else if (ev.key === 'Enter') press('=');
            } else if (ev.type === X.EVENTS.DestroyNotify && ev.window === win) {
                unsub();
            }
        });

        return { window: win, font: fid, gcLcd, gcKey, press };
    },
    xterm(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 40, 240, 380, 200, { backgroundPixel: 0x000000 });
        X.setWMName(win, 'xterm');
        X.setWMClass(win, 'xterm', 'XTerm');
        X.mapWindow(win);
        const fid = X.openFont('-misc-fixed-medium-r-normal--14-100-100-100-c-70-iso10646-1');
        const gc = X.createGC(win, { foreground: 0xc8c8c8, background: 0x000000, font: fid });
        const lines = ['$ uname -a', 'thebird-x 1.0 browser-xshim', '$ echo hello world', 'hello world', '$ _'];
        lines.forEach((s, i) => X.imageText8(win, gc, 8, 18 + i * 16, s));
        return { window: win, font: fid, gc };
    },
    xpaint(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 260, 240, 240, 200, { backgroundPixel: 0xf0f0f0 });
        X.setWMName(win, 'xpaint');
        X.mapWindow(win);
        const gc = X.createGC(win, { foreground: 0x2060c0, lineWidth: 2 });
        const stroke = [];
        for (let t = 0; t < 60; t++) {
            const x = 20 + t * 3, y = 100 + Math.sin(t / 4) * 40;
            stroke.push({ x, y });
        }
        X.polyLine(win, gc, stroke);
        const gcRed = X.createGC(win, { foreground: 0xc02020 });
        X.fillPoly(win, gcRed, [{ x: 60, y: 30 }, { x: 100, y: 80 }, { x: 20, y: 80 }]);
        return { window: win, gc, gcRed };
    },
    xpixmap(X) {
        const root = X.rootWindow();
        const win = X.createSimpleWindow(root, 460, 60, 160, 160, { backgroundPixel: 0x101820 });
        X.setWMName(win, 'xpixmap');
        X.mapWindow(win);
        const pix = X.createPixmap(win, 64, 64);
        const gcP = X.createGC(pix, { foreground: 0xff8040 });
        X.polyFillRectangle(pix, gcP, [{ x: 0, y: 0, w: 64, h: 64 }]);
        const gcP2 = X.createGC(pix, { foreground: 0x40c0ff });
        X.polyFillArc(pix, gcP2, [{ x: 8, y: 8, w: 48, h: 48 }]);
        const gcCopy = X.createGC(win, {});
        for (let i = 0; i < 4; i++) X.copyArea(pix, win, gcCopy, 0, 0, 16 + i * 24, 48, 64, 64);
        return { window: win, pixmap: pix, gcP, gcCopy };
    },
};

export function runXProgram(X, name) {
    const fn = X_PROGRAMS[name];
    if (!fn) throw new Error('unknown x program: ' + name);
    return fn(X);
}
