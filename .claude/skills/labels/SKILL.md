---
name: labels
description: Choose the right issue status, issue type, issue labels and pull request labels for ClaudeOS. Use when you open, triage, label, type, set the status of, close or link an issue or pull request.
---

# Issue status, type, labels and PR labels

Use this skill whenever you open, triage, label, type, set the status of, close or link an issue or pull request in ClaudeOS.

## Issue status

Every issue has one status. It shows where the work stands. Set it in the sidebar, or with the `setIssueStatus` GraphQL mutation.

| Status | Set it when |
| --- | --- |
| **Backlog** | The issue is new and nobody has planned it. This is the default. |
| **Todo** | The work is planned and will start soon. |
| **In progress** | A person or the AI has started the work. |
| **In review** | A pull request for the issue is open and not yet merged. |
| **Done** | The pull request has merged. The issue closes as completed. |
| **Not planned** | The work will not be done. The issue closes as not planned and gets the `dont-do` label. |
| **Duplicate** | Another issue covers the same work. The issue closes as duplicate and links the original. |

Rules:
- Move an issue to **In progress** before you start work on it.
- Move it to **In review** when you open its pull request.
- Do not move it to **Done** by hand. It moves to Done when the pull request merges.
- Close the issue with the matching close reason: completed for Done, not planned for Not planned, duplicate for Duplicate.

## Issue type

Every issue has one type. Set it in the sidebar. The types are:

- **Bug**: something does not work as it should. Pair it with the `bug` label.
- **Feature**: a new capability or a change to behaviour. Pair it with the `enhancement` label.
- **Task**: other work, such as cleanup, a refactor, a docs change or a setup step. Pair it with the `documentation`, `ci` or `question` label where one fits.

There is no `Docs` type. Use **Task** with `documentation`. Issue types are created in an organization. This repo belongs to a personal account, so no new type can be added until the repo moves.

Pull requests have no type. A pull request's kind comes from its title prefix: `fix`, `feat`, `docs`, `ci`, `refactor`, `chore`, `test`.

## Issue labels

Use labels for area, kind and AI handling. Add only the labels that fit.

| Label | Use it for |
| --- | --- |
| `bug` | Pair with the Bug type. |
| `enhancement` | Pair with the Feature type. |
| `question` | More information is needed before anyone can act. |
| `documentation` | Docs and README work. |
| `needs-info` | The issue is missing template sections. Name them in a comment. |
| `tablet` | Device and kiosk behaviour on the tablet. |
| `android` | Code under `android/`, the Java app. |
| `hub` | The PC server and host (`src/core/server`, `host/`). |
| `claude-app` | The sessions screen and the PC link. |
| `home` | The Home screen. |
| `apps` | Weather, Calendar, Lists, Browser and the other apps. |
| `voice` | Microphone and voice commands. |
| `ci` | GitHub Actions and checks. |
| `ai-fix` | Ask the AI to triage the issue and fix it in a pull request. A person with write access adds it. |
| `ai-blocked` | The AI fix stopped at a gate. |
| `dont-do` | The AI checked the issue and decided not to change anything. |

Do not add `ai-fix` to work that a person should do. A PIN change, for example, is a person's task.

## Pull request labels

| Label | Meaning |
| --- | --- |
| `ai-review` | Run the AI code review on this pull request. Only labeled pull requests are reviewed. |
| `ai-generated` | The AI made this pull request. The AI never approves it. |
| `ci` | The change touches GitHub Actions or checks. The labeler adds this from the paths. |
| `github_actions` | The change touches GitHub Actions code. The labeler adds this from the paths. |
| `dependencies` | The change touches a dependency file. |
| `documentation` | Docs or README changes. |
| Area labels (`tablet`, `android`, `hub`, `claude-app`, `home`, `apps`, `voice`) | The area the change touches. |

Pull requests have no status in this repo.

## Milestone (issues and pull requests)

A milestone groups work toward one goal. The open milestone is:

- **Deprecate the PC app**: work that removes or replaces the PC hub.

Set a milestone only when the item belongs to it. Do not create a milestone without asking first.

## Relationships (issues and pull requests)

- **Closing an issue from a pull request**: put `Fixes #N` as the last line of the PR body, once. Merging closes the issue, and its status becomes Done.
- **Referencing**: put `#N` in a body or comment to link another issue or PR. A reference does not close anything.
- **Duplicates**: set the status to Duplicate, close the duplicate, and link the original in a comment.
- **Blocking**: use the sidebar's sub-issue and blocked-by fields when one item must finish before another. Name the blocker in the body as well.

## How the repo uses these

- **Automatic**: the labeler adds `ci`, `github_actions`, `dependencies` and area labels to pull requests from the paths they touch.
- **The AI fix flow** (`.github/workflows/claude-fix.yml`): a person adds `ai-fix` to an issue. The AI sets the status to In progress, then In review when it opens the pull request. The pull request gets `ai-generated` and `ai-review`. When the pull request merges, the issue closes as completed and becomes Done. A no-change run adds `dont-do`, sets Not planned and closes it. A gate stop adds `ai-blocked`.
- **The AI review** (`.github/workflows/claude-code-review.yml`): it runs only on pull requests with `ai-review`. An `ai-generated` pull request is never approved.
- **Milestones and types** are set by people. The AI sets only the status and the labels above.

## Choosing

1. Set the type: Bug, Feature or Task.
2. Set the status: Backlog for new work, Todo when planned, In progress when started.
3. Add area labels, then one kind label.
4. Add `needs-info` when a required section is missing.
5. Add `ai-fix` only when the AI should do the work.
6. For a pull request, add the area labels, plus `ai-review` when it needs an AI review.
