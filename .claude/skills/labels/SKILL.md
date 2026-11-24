---
name: labels
description: Choose the right label and status for a ClaudeOS issue or pull request. Use when you open, triage, label or close an issue or PR.
---

# Labels and statuses

Use this skill when you add labels to an issue or pull request, or when you close one.

## Statuses

An issue or pull request has two states: open or closed.

When you close an issue, GitHub asks for a reason. Use one of these:

- **completed**: the change is done, or the fix is merged.
- **not planned**: the issue will not be done. Add the label `dont-do` too, and say why in one line.
- **duplicate**: the issue repeats another. Link the other issue in a comment.

Do not close an issue as completed until its pull request merges.

## Issue type (issues only)

Every issue has one type. Set it in the sidebar. The types are:

- **Bug**: something does not work as it should. Use it with the `bug` label.
- **Feature**: a new capability or a change to behaviour. Use it with `enhancement`.
- **Task**: work that is not a bug or a feature, such as a PIN cleanup, a refactor or a chore.

There is no `Docs` type. Use **Task** with the `documentation` label for docs work. Issue types are created in an organization's settings. This repo is owned by a personal account, so a new type cannot be added until the repo moves to an organization.

Pull requests have no type. Their kind comes from the title's Conventional Commits prefix: `fix`, `feat`, `docs`, `ci`, `chore`, `refactor`, and so on.

## Milestone (issues and pull requests)

A milestone groups work toward one goal. Set one only when the item belongs to an open milestone. The open milestone is:

- **Deprecate the PC app**: work that removes or replaces the PC hub.

Leave the milestone empty for everything else. Do not create a milestone without asking first.

## Relationships (issues and pull requests)

- **Closing a pull request**: put `Fixes #N` as the last line of the PR body. Merging closes the issue. Use `Fixes` once, not twice.
- **Referencing**: put `#N` in a body or comment to link another issue or PR. Do not close an issue that only references another.
- **Duplicates**: close the duplicate as `duplicate` and link the original in a comment.
- **Sub-issues and blocking**: use the sidebar's parent and sub-issue fields, and the "blocked by" field, when one item must finish before another. Name the blocker in the issue body too, so a reader sees it without the sidebar.

## Area labels (issues and pull requests)

Pick one or two. Use the label that names where the change lands.

| Label | Use it for |
| --- | --- |
| `tablet` | Device and kiosk behaviour on the tablet. |
| `android` | Code under `android/`, the Java app. |
| `hub` | The PC server and host (`src/core/server`, `host/`). |
| `claude-app` | The Claude sessions screen and the PC link. |
| `home` | The Home screen. |
| `apps` | Weather, Calendar, Lists, Browser and the other apps. |
| `voice` | Microphone and voice commands. |
| `ci` | GitHub Actions and checks. |
| `github_actions` | Pull requests that change GitHub Actions code. |
| `documentation` | Docs and README changes. |
| `dependencies` | Pull requests that change a dependency file. |

## Type labels (issues)

| Label | Use it for |
| --- | --- |
| `bug` | Something does not work. |
| `enhancement` | A new feature or an improvement. |
| `question` | More information is needed before anyone can act. |
| `needs-info` | The issue is missing template sections. Name them in a comment. |

## AI labels

These labels start or describe AI work. Add them only when the task fits.

| Label | Meaning | Who adds it |
| --- | --- | --- |
| `ai-fix` | Ask the AI to triage the issue and fix it in a pull request. | A person with write access. |
| `ai-review` | Run the AI code review on this pull request. | A person, or the AI when it opens a pull request. |
| `ai-generated` | The AI made this pull request. Its review never approves it. | The AI. |
| `ai-blocked` | The AI fix stopped at a gate. | The AI. |
| `dont-do` | The AI checked the issue and decided not to change anything. | The AI, with the close as not planned. |

Do not add `ai-fix` to a non-AI task. A PIN change, for example, is a person's task.

## Choosing

1. Is the work a bug, a feature, or a question? Pick one type label.
2. Which area does it touch? Pick the area label.
3. Is the issue missing template sections? Add `needs-info` and name the sections.
4. Should the AI do it? Add `ai-fix` only then.

Use the issue template in CLAUDE.md. Delete a section only when it does not apply.
