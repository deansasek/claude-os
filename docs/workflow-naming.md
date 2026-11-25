# Workflow naming

How to name the GitHub Actions workflows, jobs and steps in ClaudeOS. Follow it for each new workflow. Rename old names only with a PR that also updates the places that use them (see [Names that other things depend on](#names-that-other-things-depend-on)).

Based on the workflow organization guidance in [GitHub Actions workflows: patterns and best practices](https://dev.to/datanestdigital/github-actions-workflows-github-actions-patterns-best-practices-pge#workflow-organization), adapted to this repo.

## One workflow, one job

Each workflow file has one purpose. Do not put unrelated jobs in one file. Separate files can be re-run on their own and are easier to debug.

## File names

- Use kebab-case with the `.yml` extension: `pr-checks.yml`, `claude-code-review.yml`.
- Name the file for its purpose, not for the tool: `ci.yml` runs the tests, `labeler.yml` adds labels.
- Start the name with `claude-` when the workflow runs the AI (`claude-fix.yml`, `claude-code-review.yml`).
- Do not use a `.yaml` extension. Every existing workflow uses `.yml`.

## Workflow names (`name:`)

- Set `name:` on every workflow. It shows in the Actions tab.
- Use Title Case with short words: `CI`, `PR checks`, `Claude Code Review`.
- Keep each name unique. The name should say what the workflow does.

## Job IDs

- Use lowercase kebab-case. The job ID is the key under `jobs:`.
- Name the job for the check it does: `check`, `hygiene`, `size`, `claude-review`.
- Add a job `name:` only when the check name in the PR needs to read differently from the ID.

## Step names

- Give each step a `name:` in sentence case, as a short phrase: `Install dependencies`, `Run the tests`.
- Use `id:` only when a later step reads the step's output.

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
| Job IDs `check`, `hygiene`, `size` | Required status checks on `main` (branch protection). A rename blocks merges until the rule is updated. |
| Job ID `claude-review`, workflow `claude-code-review.yml` | The `ai-review` label, the review docs in `.claude/skills/review-verdict/`, and the wiki pages on the review flow. |
| Workflow `claude-fix.yml` | The `ai-fix` label that starts it, and the fix flow docs in `.claude/skills/labels/`. |
| Workflow `labeler.yml` | The labeler's rules for area labels. |

## Known gaps

- The workflow `name:` values do not all follow one pattern yet. `Claude Issue Fix` and `Claude Code` are named differently from the file names. Fix them in a separate PR.
- The guidance above covers names only. It does not cover workflow structure, such as reusable workflows or concurrency. Add those in another guide.
