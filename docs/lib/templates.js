// Instance-template system: load plain-JSON scene templates (docs/templates/)
// and apply them to a freshly created instance's fs/config.
//
// docs/templates/ holds plain-data JSON files (no JS), each shaped:
//   { name, description, workspace: {"/path": "content", ...}, env: {K:V},
//     startupScript: string|null, skills: {enabled: []}, plugins: {enabled: []},
//     overrides: {pkgName: stubSpec|null}, schemaVersion: 1 }
//
// `overrides` is a per-template npm native-dependency stub map (see
// docs/lib/npm-stubs.js NATIVE_DEP_STUBS): {pkgName: null | replacementSpec}.
// It MERGES with (and, per package name, takes precedence over) the built-in
// NATIVE_DEP_STUBS map for instances created from this template, letting a
// template author add project-specific native-dep stubs beyond the built-in
// short list. Stored on the instance config as cfg.npmOverrides and read by
// shell-npm.js's install resolution path.

// KNOWN LIMITATION: thebird has no build step and static servers here don't
// expose directory listing, so there is no way to discover docs/templates/*.json
// at runtime. New template files MUST be added to this array by filename or
// listTemplates() will never see them. This is a real constraint of the
// build-step-free static-site architecture, not an oversight.
const KNOWN_TEMPLATE_FILES = ['default.json', 'web-dev.json', 'data-explorer.json'];

// Resolve docs/templates/ relative to THIS module's URL so it works regardless
// of the page that imported it (matches the module-URL-relative fetch pattern
// used elsewhere in docs/*.js).
const TEMPLATES_BASE = new URL('../templates/', import.meta.url);

export async function listTemplates() {
    const out = [];
    for (const filename of KNOWN_TEMPLATE_FILES) {
        try {
            const res = await fetch(new URL(filename, TEMPLATES_BASE));
            if (!res.ok) { console.warn('[templates] failed to fetch', filename, res.status); continue; }
            const tpl = await res.json();
            out.push({ ...tpl, _filename: filename });
        } catch (e) {
            console.warn('[templates] failed to load', filename, e);
        }
    }
    return out;
}

// Merges a template with user-provided instance-creation options.
// Record-shaped fields (workspace, env, skills.enabled, plugins.enabled) are
// unioned per-key; options win on conflicting keys. Scalars (name,
// description, startupScript) are replaced wholesale by options when options
// provides a non-null value, else fall back to the template's value.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Copies only safe own-enumerable keys from src onto target, skipping
// __proto__/constructor/prototype so an externally-sourced object (template
// JSON file content, or caller-supplied options) can never smuggle a
// prototype-chain-affecting key through a merge into cfg.env/cfg.npmOverrides/
// cfg.workspace. Object.prototype.hasOwnProperty.call guards against src
// itself being Object.create(null) (no prototype method to call directly).
function safeAssign(target, src) {
    if (!src || typeof src !== 'object') return target;
    for (const key of Object.keys(src)) {
        if (UNSAFE_KEYS.has(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
        target[key] = src[key];
    }
    return target;
}

export function mergeTemplateWithOptions(template, options = {}) {
    const t = template || {};
    const o = options || {};

    const scalar = (key) => (o[key] != null ? o[key] : (t[key] != null ? t[key] : null));

    const mergeRecord = (a, b) => safeAssign(safeAssign({}, a), b);
    const mergeArrayUnion = (a, b) => {
        const set = new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
        return [...set];
    };

    return {
        name: scalar('name'),
        description: scalar('description'),
        workspace: mergeRecord(t.workspace, o.workspace),
        env: mergeRecord(t.env, o.env),
        startupScript: scalar('startupScript'),
        skills: { enabled: mergeArrayUnion(t.skills && t.skills.enabled, o.skills && o.skills.enabled) },
        plugins: { enabled: mergeArrayUnion(t.plugins && t.plugins.enabled, o.plugins && o.plugins.enabled) },
        overrides: mergeRecord(t.overrides, o.overrides),
        schemaVersion: 1,
    };
}

// Applies a (possibly already-merged) template to an already-created instance.
// Writes every workspace entry via instance.fs.writeFile, and merges
// env/skills/plugins into the instance's config -- same discipline as
// docs/policy.js's readPolicyConfig/writePolicyConfig pair: read the FULL
// existing config, merge in just this template's sub-keys, write the whole
// thing back. Never touches config.providers / config.defaultProvider.
// Applies config (env/skills/plugins/overrides/startupScript) BEFORE writing
// workspace files, and never lets a single failing write abort the rest: a
// per-file exception (policy.check throwing PolicyDeniedError, any sync fs
// error) is caught and collected, so every other file plus all config still
// lands. If any file failed, throws an AggregateError-shaped summary AFTER
// everything else has been applied, so the caller sees exactly which paths
// were skipped instead of silently losing config + the write-loop tail.
export function applyTemplate(instance, template) {
    const fs = instance && instance.fs;
    if (!fs) throw new Error('applyTemplate: instance.fs required');
    const t = template || {};

    const cfg = fs.getConfig();
    cfg.env = safeAssign(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}, t.env && typeof t.env === 'object' ? t.env : {});
    cfg.skills = cfg.skills && typeof cfg.skills === 'object' ? cfg.skills : {};
    cfg.skills.enabled = [...new Set([...(Array.isArray(cfg.skills.enabled) ? cfg.skills.enabled : []), ...((t.skills && Array.isArray(t.skills.enabled)) ? t.skills.enabled : [])])];
    cfg.plugins = cfg.plugins && typeof cfg.plugins === 'object' ? cfg.plugins : {};
    cfg.plugins.enabled = [...new Set([...(Array.isArray(cfg.plugins.enabled) ? cfg.plugins.enabled : []), ...((t.plugins && Array.isArray(t.plugins.enabled)) ? t.plugins.enabled : [])])];
    cfg.npmOverrides = safeAssign(cfg.npmOverrides && typeof cfg.npmOverrides === 'object' ? cfg.npmOverrides : {}, t.overrides && typeof t.overrides === 'object' ? t.overrides : {});
    if (t.startupScript != null) cfg.startupScript = t.startupScript;
    fs.setConfig(cfg);

    const workspace = t.workspace && typeof t.workspace === 'object' ? t.workspace : {};
    const failures = [];
    for (const [path, content] of Object.entries(workspace)) {
        try {
            if (typeof path !== 'string' || path.length === 0 || path[0] !== '/' || path.split('/').includes('..')) {
                throw new Error(`applyTemplate: rejected non-absolute or traversal path "${path}"`);
            }
            fs.writeFile(path, content);
        } catch (e) {
            failures.push({ path, error: e });
        }
    }

    if (failures.length) {
        const err = new Error(`applyTemplate: ${failures.length} of ${Object.keys(workspace).length} workspace file(s) failed to write: ${failures.map(f => f.path).join(', ')}`);
        err.failures = failures;
        err.partial = true;
        throw err;
    }

    return instance;
}
