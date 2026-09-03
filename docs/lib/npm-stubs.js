// Native-dependency override/stub mechanism for the in-browser npm-install
// path (docs/shell-npm.js). Some npm packages ship node-gyp-built or
// prebuilt .node native binaries that cannot possibly run in a browser
// runtime. Rather than letting `npm install` fail (or hang trying to fetch
// something that can never resolve), these packages resolve to either:
//   - null: install an inert no-op stub package instead of the real one.
//   - a replacement package spec (e.g. 'is-number@7'): redirect the install
//     to that trivially-installable substitute instead.
// This must NOT fail the overall `npm install` -- it lets the rest of a
// dependency tree install successfully even when one native-dep package is
// unshippable in-browser.
export const NATIVE_DEP_STUBS = {
  'sharp': null,
  'bcrypt': null,
  'canvas': null,
  'sqlite3': null,
  'node-gyp': null,
};

// Merges a per-instance template override (docs/lib/templates.js `overrides`
// field: {pkgName: stubSpec}) on top of the built-in NATIVE_DEP_STUBS map.
// The per-instance map takes precedence for any package name present in
// both. `stubSpec` follows the same null|string contract as NATIVE_DEP_STUBS.
export function resolveNativeDepStubs(instanceOverrides) {
  return { ...NATIVE_DEP_STUBS, ...(instanceOverrides && typeof instanceOverrides === 'object' ? instanceOverrides : {}) };
}

// Looks up `name` in the merged stub map. Returns undefined if `name` has no
// override (proceed with the normal install path), otherwise the stub value
// (null | replacement spec string).
export function lookupNativeDepStub(name, instanceOverrides) {
  const merged = resolveNativeDepStubs(instanceOverrides);
  return Object.prototype.hasOwnProperty.call(merged, name) ? merged[name] : undefined;
}

// Writes a minimal inert stub package (package.json + empty index.js) into
// the target node_modules-equivalent location, for the `null` case. Takes
// the snap()-shaped fs record directly so callers control persistence.
export function writeInertStub(s, name, version) {
  const base = 'node_modules/' + name;
  s[base + '/package.json'] = JSON.stringify({ name, version: version || 'stub', description: 'inert stub: native dependency unsupported in-browser', main: 'index.js' }, null, 2);
  s[base + '/index.js'] = '// inert stub: ' + name + ' has a native (C/C++) dependency and cannot run in a browser runtime.\n// This is a no-op placeholder installed so the rest of the dependency tree can still resolve.\nexport default {};\n';
}
