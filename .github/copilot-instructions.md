# GitHub Copilot workspace instructions

## Repository boundaries

- The active game implementation lives in the `app/game` Git submodule, whose
  remote must be `Mystouille/kandora-game`.
- Never make product changes in a game copy under `scriptsIgnored`; those
  folders are temporary or reference-only and are not consumed by the app.
- Before changing game code, verify the parent repository, run
  `git submodule status app/game`, and inspect `git -C app/game status --short`.
- Review game diffs from inside the submodule with `git -C app/game diff`. The
  parent repository will otherwise show only `m app/game`.
