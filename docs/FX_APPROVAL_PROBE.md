# fx approval probe (cda7b4aa)

Question: does the fx terminal build from fx commit cda7b4aa ("Give tool admission the host's tools in the terminal build, so a host tool that writes opens the approval panel in ask mode") open the approval panel for a bash tool call in the thebird page?

## Build

- Source: `git archive cda7b4aa` of `/workspace/fx/fx`, extracted to a scratch directory outside the repo. `/workspace/fx/fx` was not built into or written to.
- Command: `zig build fx-term-wasm -Dwasm-surface=term` (zig 0.17.1).
- Output: `fx-term.wasm`, 4927881 bytes, sha256 `769d321aa6523aaa8ece90020a6044ca8895def0a427850509693081a161d8d3`. Build wall time 4 m 35 s.
- fx HEAD is now 8 commits past cda7b4aa and still contains it. The probe used cda7b4aa, as asked.

## Run

- Command: `node scripts/witness.mjs --group=fx-approval`, with the cda7 wasm copied over `web/vendor/fx/fx-term.wasm` for the run.
- Result: `FAIL fx-approval raised an error: Runtime.evaluate did not answer within 60000 ms`. `GROUP fx-approval wall 241.6s`. `totals: PASS 0 FAIL 1 GROUPS 1 WALL 241.6s`.
- The first attempt ran while host load was 27 and hit the 900 s bound with no output (exit 124). The load gate was holding the group back. The second attempt ran at load 4 and gave the result above.
- The group threw inside its interaction, so none of its checks ran. The panel's state was not read, so this run does not confirm or deny that the panel opened.

## Earlier observation

An earlier run of the same probe, recorded in the previous session, reached the bash approval submit and then wedged the TUI page: a `Runtime.evaluate` on the page timed out after the submit, the same 60 s error. The approval row has not passed against this build.

## Welcome text

The welcome text was not read in these runs, because the group threw before its welcome checks completed. Its presence is not established either way for this build.

## Vendored build

`web/vendor/fx/fx-term.wasm` was restored with `git checkout` to the committed build, sha256 `d323fcf5cdf5b2c7b82593c75235869d20da2e028c5ccc12b1766d275005370e`. The cda7b4aa build is not vendored or committed.

## Next

- Read the TUI state after each step of the approval interaction, so a wedge shows which step it occurs at.
- The fx side must decide whether the page wedge after the bash approval submit is a fx bug or a page bug before the approval row can pass.
