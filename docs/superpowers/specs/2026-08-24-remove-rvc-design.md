# RVC Local Purge Design

> **SUPERSEDED / HISTORICAL ONLY — DO NOT IMPLEMENT**
> Superseded by the completed Piper-only production cutover. RVC archive evidence is retained separately; current production authority is the final Piper-only evidence.

Date: 2026-08-24

## Goal

Remove the local RVC implementation, artifacts, documentation, and Git refs
from the Joy workspace while preserving the Piper-only audio path (STT, Piper, and FFmpeg).

## Scope

- Delete RVC-only runtime, model, archive, temporary, and worktree paths.
- Remove RVC-only files and references from mixed source, configuration,
  tests, and documentation.
- Delete local RVC branches, remote-tracking refs, and reflogs; prune Git
  objects that become unreachable.
- Leave the current `main` commit history intact; do not rewrite commits or
  alter the configured remote.

## Safety boundary

Only paths and code identified by an RVC-specific reference will be changed.
Shared audio code remains in place and its behavior will be verified after the
purge. Existing unrelated working-tree changes, if any, will be preserved.

## Verification

After the purge:

1. Search the live workspace and Git refs for case-insensitive `rvc` matches.
2. Confirm no RVC-only paths remain.
3. Run the relevant audio/backend tests or the available project verification
   command.
4. Check audio and backend health endpoints and confirm the non-RVC path is
   healthy.
