# Pyodide notice

Pyodide is not vendored or generated in this repository. The Python runtime is
the stripped bundle `https://anentrypoint.github.io/pyodide-minimal/pyodide-minimal.br`,
fetched at run time by `web/python-bundle.js` and never committed. The core it
carries is Pyodide 314.0.7.

- Upstream: Pyodide 314.0.7 from https://github.com/pyodide/pyodide.
- Licence: MPL-2.0. The npm package declares `"license": "MPL-2.0"` in its
  `package.json` and ships no LICENSE file, so this notice cites that field.
- Bundled Python: the CPython standard library is under the Python Software
  Foundation licence.
- Licence of the stripped bundle: held by the owner, not yet confirmed. See
  `docs/PENDING_VALIDATION.md`.
- Pinned SHA-256 of the Pyodide 314.0.7 lock, read by the witness from
  `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json` before it
  reads micropip from it: `5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010`.
- Our code that uses it is `web/python-in-page.js` and `web/python-worker.js`,
  which are ours and are not part of the Pyodide package.
