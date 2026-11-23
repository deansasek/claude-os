---
name: issue
description: Create a GitHub issue in the ClaudeOS repo with gh, using the CLAUDE.md issue template and a Conventional Commits-style title. Use when asked to "file an issue", "open an issue", "create a ticket", "log a bug", or "report this bug". Not for opening a pull request (use the pr skill).
---

# Issue

Follow CLAUDE.md "Issue template" and "Rule: no visible Android".

## Steps

1. Check for a duplicate: `gh issue list --search "<key words>" --state all`. If one exists, report it instead of filing a new issue.
2. Write the title in Conventional Commits form: `<type>(<scope>): <short description>`. Use `fix` for a bug and `feat` for a request. Pick the scope as the commit skill does (app name, `core`, `voice`, `android`, `host`).
3. Fill in the CLAUDE.md "Issue template". Use short, active sentences. Remove a section only if it does not apply.
   - Where: name the device (tablet, cast device, or PC hub) and the screen or app.
   - Actual: if Android UI reaches the user, say so. Treat that as a bug.
   - Evidence: attach or link a screenshot, read-only adb output (`adb exec-out screencap -p`, `adb shell dumpsys`), or hub log lines. Do not paste secrets or tokens.
4. Pick a label: `bug` for `fix`, `enhancement` for `feat`, `documentation` for `docs`.
5. Write the body to a temporary file, then run `gh issue create --title "<title>" --body-file <file> --label <label>`.
6. Do not add attribution: no AI tool names or generator tags. Report the issue URL.

## Example

Title: `fix(android): stock dock shows after a swipe up from the bottom edge`

```markdown
## Problem
A swipe up from the bottom edge shows Android's white dock over ClaudeOS.

## Where
- Device: tablet
- Screen or app: any screen, seen on Home
- Build: 182d0bb

## Steps
1. Open Home.
2. Swipe up from the bottom edge.

## Expected
The ClaudeOS page switcher opens. No Android UI shows.

## Actual
Android's Taskbar dock shows for about one second.

## Evidence
`adb exec-out screencap -p > dock.png` (attached).

## Proposed solution
Hide the Taskbar package as device owner in `lockdown()`.
```
