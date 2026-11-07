# Architecture

```
bin/thebird.js -> src/cli.js -> src/commands.js
                       |
                       v
                  src/index.js (library)
                       |
                       v
              src/gm.js -> gm createTools() -> gm verbs
```

There is one boundary. thebird owns argument parsing, command aliases and the
REPL. gm owns every real operation. The legacy browser runtime, vendored kits,
service workers, LLM gateways and per-instance virtual filesystems remain in
the tree pending an owner-held deletion decision; none of them is on this CLI's
execution path.
