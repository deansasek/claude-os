---
name: commit
description: Write and make a git commit in the ClaudeOS repo with a Conventional Commits message. Use when asked to "commit", "commit this", "write a commit message", or "make a commit". Not for opening a pull request (use the pr skill).
---

# Commit

Follow CLAUDE.md "Rule: branches and pull requests" and "Rule: PR bodies and commits".

## Steps

1. Run `git status` and `git diff --staged` (or `git diff`). If the current branch is `main`, create a branch first (see the pr skill for names). Do not commit to `main` unless the repository owner asks.
2. Stage only the files for this change. Do not stage secrets, `logs/`, `workspace/`, or `.claude/settings.local.json`.
3. Pick the type:
   - `feat`: new behavior the user sees. `fix`: a bug, including any Android UI that reaches the user.
   - `refactor`, `perf`, `test`, `docs`, `chore` (build, tooling, deps), `style`, `ci`, `revert`.
4. Pick the scope from the main area the diff touches:
   - `src/apps/<app>/` -> the app name: `home`, `clock`, `claude`, `calendar`, `lists`, `photos`, `routines`, `settings`, `weather`, `browser`, `camera`, `launcher`, `home-assistant`.
   - Voice parsing and voice commands -> `voice`.
   - `src/core/` -> `core`. `android/` -> `android`. `host/` -> `host`. `public/` -> `public`. `scripts/` -> `scripts`. `test/` only -> `test`.
   - `docs/` or `README.md` -> type `docs`, scope `readme` or the doc name. CLAUDE.md or `.claude/` -> type `docs`, no scope.
   - Several areas: use the main one, or omit the scope.
5. Write the subject: lower case, imperative, no full stop, about 72 characters or less. Say what changes for the user, not which function changed.
6. Add a body only if the subject cannot say why. Use short, active sentences. Add `BREAKING CHANGE:` in the footer if a change breaks something.
7. Do not add attribution: no AI tool names, generator tags, or `Co-authored-by` lines.
8. Commit with `git commit -m "<subject>"` (add `-m "<body>"` for a body).

## Example

```
fix(android): hide the Taskbar package as device owner so a bottom swipe shows no stock dock
```
