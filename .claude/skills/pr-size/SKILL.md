---
name: pr-size
description: Check the size of a ClaudeOS branch against the CLAUDE.md "PR size" limits and split it into a stack of small GitHub PRs when it is too big. Use when asked to "split this PR", "is this PR too big", "make a stack", "stacked PRs", "break this into PRs", or "PR size". Not for opening a single PR that is already small (use the pr skill).
---

# PR size

Follow CLAUDE.md "PR size" and "Stacked PRs".

## Steps

1. Measure the diff: `git fetch origin`, then `git diff --stat origin/main...HEAD` (or `main...HEAD` if local `main` is current). Leave out deleted files, lockfiles, and generated output.
2. Decide against the limits: one self-contained idea, about 300 changed lines, about 10 files. Also split if the diff mixes a refactor with a feature or fix, unrelated fixes, a large moved or generated file, or areas that need different reviewers (for example `android/` and `src/apps/`).
3. If the diff fits, say so and go on with the pr skill.
4. If the diff is too big, list the pieces in merge order. Put a refactor with no behavior change first. For each piece give:
   - the branch name, `<type>/<kebab-name>`;
   - the base: `main` for the bottom piece, else the branch below it;
   - the files or commits it takes, and its tests.
   Each piece must leave the build working on its own.
5. Build the stack from the bottom up. For each piece: `git switch -c <branch> <base>`, bring in its changes (`git checkout <source-branch> -- <files>` or `git cherry-pick <commits>`), then open it with the pr skill, using `--base <base>` in place of `--base main`. In `## Why`, write the place in the stack, for example `Part 2 of 3. Depends on #120.`
6. Report each PR URL with its base. Do not merge.

## Example

A 650-line branch that renames the clock timer module and adds lap times:

| # | Branch | Base | Content |
|---|--------|------|---------|
| 1 | `refactor/clock-extract-timer` | `main` | Move the timer code to its own file. No behavior change. |
| 2 | `feat/clock-lap-times` | `refactor/clock-extract-timer` | Add lap times and their tests. |
