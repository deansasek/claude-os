---
name: pr
description: Open a GitHub pull request into main for the ClaudeOS repo with gh, using the CLAUDE.md Why/What/Tests body. Use when asked to "open a PR", "create a pull request", "push and PR", or "send this for review". Not for writing a commit message alone (use the commit skill) or for filing an issue (use the issue skill).
---

# Pull request

Follow CLAUDE.md "Rule: branches and pull requests" and "Rule: PR bodies and commits".

## Steps

1. Branch from an up-to-date `main`: `git switch main`, `git pull`, `git switch -c <type>/<short-kebab-name>`. The branch prefix is the Conventional Commits type, for example `fix/hide-taskbar`, `feat/home-anthropic-redesign`, `docs/pr-body-headings`, `chore/tidy-gitignore`.
2. Commit the change with the commit skill.
3. Check the size: `git diff --stat main...HEAD` against CLAUDE.md "PR size". If the diff is too big, stop and use the pr-size skill to split it into a stack.
4. Run `npm run check` and `npm test`. Both must pass. Note any device check you did not do (for example, the apk is not built or installed).
5. Push: `git push -u origin <branch>`.
6. Write the title in Conventional Commits form, the same as the main commit subject.
7. Write the body with exactly these three headings, in plain ASD-STE100 style: short sentences, active voice, named files and components, no filler.
   - `## Why`: the problem or requirement in 1-3 sentences. Reference an issue with `Closes #<n>` if there is one.
   - `## What`: a list of the concrete changes. State any Android UI that is still visible and why.
   - `## Tests`: the exact commands and results, or "None." with the reason.
8. Do not add attribution: no AI tool names, generator tags, or co-author lines.
9. Create the PR into `main`: `gh pr create --base main --head <branch> --title "<title>" --body-file <file>`. Write the body to a temporary file first so the shell does not change backticks or `$`. In a stack, use `--base <branch below>` (see the pr-size skill).
10. Do not merge unless the repository owner asks. Report the PR URL.

## Example

Title: `fix(core): move the pull-down and switcher handles closer to the edges`

```markdown
## Why
The pull-down and switcher handles sit too far from the screen edges. A swipe from the edge often misses them.

## What
- Move the pull-down handle in `src/core/web/` to the top edge.
- Move the switcher handle to the bottom edge.

## Tests
- `npm run check`: pass.
- `npm test`: pass.
- Not tested on the tablet.
```
