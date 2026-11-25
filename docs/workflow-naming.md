# Workflow naming

How to name the GitHub Actions workflows, jobs and steps in ClaudeOS. Follow it for each new workflow. Rename an existing name only in a PR that also updates the places that use it (see [Names that other things depend on](#names-that-other-things-depend-on)).

Based on the workflow organization guidance in [GitHub Actions workflows: patterns and best practices](https://dev.to/datanestdigital/github-actions-workflows-github-actions-patterns-best-practices-pge#workflow-organization), adapted to this repo.

## One workflow, one purpose

Each workflow file serves one purpose. Jobs in one file are fine when they serve that purpose. `claude.yml` has two jobs for one purpose: `@claude` on a pull request. Do not put unrelated jobs in one file. Separate files can be re-run on their own and are easier to debug.

## File names

- Use kebab-case with the `.yml` extension: `pr-checks.yml`, `claude-code-review.yml`.
- Name the file for its purpose: `ci.yml` runs the tests.
- Start the name with `claude-` when the workflow runs the AI (`claude-fix.yml`, `claude-code-review.yml`).
- Exceptions, kept as they are: `claude.yml` is named for the tool because it answers `@claude` in any thread. `labeler.yml` is named for the action it runs.
- Do not use a `.yaml` extension. Every existing workflow uses `.yml`.

## Workflow names (`name:`)

- Set `name:` on every workflow. It shows in the Actions tab.
- Use sentence case: capitalize the first word and proper nouns, and write the other words in lower case. Examples: `CI`, `PR checks`, `Claude`, `Claude Fix`, `Label pull requests`.
- Keep each name unique. The name should say what the workflow does.

## Job IDs

- Use lowercase kebab-case. The job ID is the key under `jobs:`.
- Name the job for the check or the work it does: `check`, `hygiene`, `size`, `claude-review`.
- Add a job `name:` only when the check name in the PR needs to read differently from the ID. A job `name:` changes the required-check name the same way a rename does. See [Names that other things depend on](#names-that-other-things-depend-on).

## Step names

- Give each step a `name:` in sentence case, as a short phrase: `Install dependencies`, `Run the tests`.
- Use `id:` only when a later step reads the step's outputs. No step in this repo reads a step id today, so check before you remove one.

## Composite actions

- Put each one in `.github/actions/<name>/action.yml`.
- Name the folder in kebab-case and the action's `name:` as a phrase: `Setup Node environment`.
- No composite action exists yet. Add one only when two or more workflows repeat the same steps.

## Scheduled workflows

- No scheduled workflow exists yet. When one is added, name the file for the job it runs, such as `dependency-update.yml`, and say the schedule in a comment at the top of the file.

## Names that other things depend on

Changing these breaks something else. Change them in the same PR as the rename:

| Name | Used by |
| --- | --- |
| Job IDs `check`, `hygiene`, `size` (`ci.yml`, `pr-checks.yml`) | Required status checks on `main` in branch protection. A rename, or a job `name:`, blocks merges until the rule is updated. |
| Workflow `ci.yml` | The CI badge in `README.md` (line 21). |
| Workflow `claude-code-review.yml`, job `claude-review` | The `ai-review` label. The job's `if:` matches it. The label rules are in `.claude/skills/labels/SKILL.md` (line 100). The wiki's Review flow page describes it. |
| Workflow `claude-fix.yml` | The `ai-fix` label. The `if:` matches it (line 30). The fix flow is described in `.claude/skills/labels/SKILL.md` (lines 99 and 101). |
| Workflow `claude.yml`, job `claude-pr` | `.claude/skills/labels/SKILL.md` (line 102). |
| Concurrency group `claude-pr-<number>` in `claude.yml` | Shared by the `claude-pr` and `claude-pr-review` jobs. Changing one string lets a fix and a review run at once. |
| Workflow `labeler.yml` | Its rules are in `.github/labeler.yml`, not in the workflow file. Renaming the workflow file does not change them. |

Nothing in the repo depends on a workflow's `name:` value.

## Known gaps

These are known differences between the files and the rules above. Fix each one in its own PR.

- `claude-code-review.yml` has the name `Claude Code Review`. Under the sentence-case rule it should be `Claude Code review`.
- Job `agent` in `claude-fix.yml` names the worker, not the check. It may become `claude-fix`.
- Steps in `ci.yml` (7 steps) and `labeler.yml` (1 step) have no `name:`.
- Four step ids are set but never read: `claude-review` in `claude-code-review.yml` (line 46), `agent` in `claude-fix.yml` (line 156), and `claude` (line 90) and `claude-review` (line 178) in `claude.yml`. Check each before removing it.
- Step `Run Claude Code Review` in `claude-code-review.yml` uses Title Case. It should use sentence case.
- This guide covers names only. It does not cover workflow structure, such as reusable workflows or concurrency. Add those in another guide.
