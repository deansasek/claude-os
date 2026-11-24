---
name: review-verdict
description: Post the final review verdict on a pull request in ClaudeOS. Use after a code review to approve the pull request or deny it with request changes, using the fixed verdict template.
---

# Review verdict

Use this skill after the code review of a pull request in ClaudeOS. It sets the verdict and posts it to GitHub.

## Verdict

Choose one verdict:

- **Approved**: no important findings. Nits do not block approval.
- **Denied**: at least one important finding. Important findings are bugs, broken behavior, security problems, data loss, or a failing check.

Do not change files. Do not merge. Do not post more than one review.

## Template

Write the review body in exactly this form. Follow the ASD-STE100 style used in the repo:

- Short sentences. One idea per sentence.
- Active voice and present tense.
- Name the file, function or behavior. Do not use "it" or "this" for an unclear subject.
- No filler, no praise, no speculation.

```
## Verdict
**Approved** or **Denied**

## Why
One to three short sentences. State what the pull request changes and whether the change works.

## Findings
- `path/to/file:line` - the problem, in one sentence. Mark it **important** or **nit**.
```

Write `None.` under `## Findings` when there are no findings.

## Post the verdict

1. Find the pull request number from the prompt.
2. Write the template to `$RUNNER_TEMP/review-verdict.md`.
3. Check the labels: `gh pr view <number> --json labels --jq '.labels[].name'`.
4. Post it with GitHub:
   - Approved, and the PR has no `ai-generated` label: `gh pr review <number> --approve --body-file "$RUNNER_TEMP/review-verdict.md"`
   - Approved, and the PR has the `ai-generated` label: `gh pr review <number> --comment --body-file "$RUNNER_TEMP/review-verdict.md"`. Never approve an AI-made PR. A person approves and merges it.
   - Denied: `gh pr review <number> --request-changes --body-file "$RUNNER_TEMP/review-verdict.md"`, with or without the label.

GitHub shows a denial as "Request changes". The template keeps the word **Denied** so the verdict reads clearly in the review body.

If `gh` fails, report the error in the run output and stop. Do not retry with another method.
