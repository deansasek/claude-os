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

Do not change repository files. Do not merge. Do not post more than one review. Do not post a review with a body, except the short denial body in step 3.

## Template

The verdict is the note. Write the note in exactly this form. Follow the ASD-STE100 style used in the repo:

- Short sentences. One idea per sentence.
- Active voice and present tense.
- Name the file, function or behavior. Do not use "it" or "this" for an unclear subject.
- No filler, no praise, no speculation.

```
### Code review of PR #<number>

- [x] Check eligibility (open, not draft, no earlier Claude review)
- [x] Gather CLAUDE.md paths (root `CLAUDE.md` only)
- [x] Summarize the diff
- [x] Run four review passes (two CLAUDE.md, two bug)
- [x] Validate findings
- [x] Post summary and verdict

**Result:** no issues found, or the number of findings. Checked for bugs and CLAUDE.md compliance.

One or two short sentences: what the pull request changes and whether the change works.

**Verdict:** ✅ Approved, or ❌ Denied. One sentence on the next step.

**Findings:**
- `path/to/file:line` - the problem, in one sentence. Mark it **important** or **nit**. Write `None.` when there are no findings.

**Notes:**
- One short bullet for each point the reviewer must know, such as a review that was not posted or a check that was skipped. Omit this section when there is nothing to add.
```

## Post the verdict

1. Find the pull request number from the prompt.
2. Check the labels: `gh pr view <number> --json labels --jq '.labels[].name'`.
3. Post the review with `gh pr review` only as follows. Do not pass `--body-file`.
   - Approved, for any PR, with or without the `ai-generated` label: `gh pr review <number> --approve`. GitHub records the approval with no comment body.
   - Denied, for any PR: `gh pr review <number> --request-changes --body "Denied. See the review summary."`. GitHub requires a body for this event, so this adds one short comment. Do not add more text to the body.
4. Write the note as described in "Write the note". The note carries the verdict and the findings. Do not post them as a review.

GitHub shows a denial as "Request changes".

## Write the note

1. Write the note to `$RUNNER_TEMP/note.md` in the template form. The first line is `<!-- claudeos-note -->`.
2. Run `node scripts/fix-note.ts <number> $RUNNER_TEMP/note.md`. The script updates the existing Claude note on the pull request, or posts a new note when none exists.
3. Post no other comment.

## Changed since last review

Use this section on a re-review only. Omit it on a first review.

1. Run `node scripts/fix-note.ts --read <number>` to print the previous note. Print nothing means a first review.
2. For each finding in the previous note, write one line: fixed, or still open. Name the file and line.
3. Add each new finding. Mark it **important** or **nit**.
4. Append these lines to the note after the **Notes** section, under the heading **Changed since last review**.

If `gh` fails, report the error in the run output and stop. Do not retry with another method.
