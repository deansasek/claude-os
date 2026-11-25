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

Do not change repository files. Do not merge. Do not post more than one review. Do not post a review with a body, except the short denial body in "Post the verdict" step 4.

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

Two or three short sentences, in plain words, with no label: what the pull request changes and what the review found.

**Result:** no issues found, or the number of findings. Checked for bugs and CLAUDE.md compliance.

**Verdict:** ✅ Approved, or ❌ Denied. One sentence on the next step.

**Findings:**
- `path/to/file:line` - one sentence on the problem. **Why it matters:** one sentence on the impact for the reader or the code. Mark it **important** or **nit**. Write `None.` when there are no findings.

**Notes:**
- One full sentence for each point the reviewer must know, such as a review that was not posted or a check that was skipped. Write the sentence in full, not as a fragment. Omit this section when there is nothing to add.
```

## Post the verdict

1. Find the pull request number from the prompt.
2. Check the labels: `gh pr view <number> --json labels --jq '.labels[].name'`.
3. Write the note first, as described in "Write the note". The note is the deliverable.
4. Post the review with `gh pr review` only as follows. Do not pass `--body-file`. This step is best-effort.
   - Approved, for any PR, with or without the `ai-generated` label: `gh pr review <number> --approve`. GitHub records the approval with no comment body.
   - Denied, for any PR: `gh pr review <number> --request-changes --body "Denied. See the review summary."`. GitHub requires a body for this event, so this adds one short comment. Do not add more text to the body.
5. If the review post fails, do not stop and do not retry. Add this sentence under **Notes:** in the note file at `<note path>`, then run "Write the note" steps 2 to 4 again: "The verdict was not posted as a GitHub review, because GitHub does not let the author approve or request changes on its own pull request. The verdict is in this note."

GitHub shows a denial as "Request changes".

## Write the note

Write the note before posting the review. The note is the deliverable. Use the Write tool and `gh api` only. Do not run `node`. The action denies commands that run code from the checkout.

Run one command per Bash call. Never chain commands with `;`, `&&`, or `||`.

1. Write the note with the Write tool to the absolute path given in the prompt. That path is `<runner temp>/note.md`. Call it `<note path>` below. Use the template form. The first line is `<!-- claudeos-note -->`.
2. Find the note id. Replace `<repo>` and `<n>`:
   ```
   gh api --paginate repos/<repo>/issues/<n>/comments --jq '.[] | select(.user.login == "claude" or .user.login == "claude[bot]") | select(.body | split("\n")[0] | test("^\\s*<!-- claudeos-note -->")) | .id'
   ```
   It prints the note id, or nothing.
3. Run the same find again just before the write. Use the id it prints.
4. If the find printed an id, update that note. Use the first id only:
   `gh api -X PATCH repos/<repo>/issues/comments/<id> -F body=@<note path> --jq .html_url`
5. If the find printed nothing, post a new note:
   `gh api -X POST repos/<repo>/issues/<n>/comments -F body=@<note path> --jq .html_url`
6. Post no other comment.

## Changed since last review

Use this section on a re-review only. Omit it on a first review.

1. Before step 4 of "Write the note", run the find from step 2. If it printed an id, run `gh api repos/<repo>/issues/comments/<id> --jq .body` to print the previous note. Print nothing means a first review.
2. For each finding in the previous note, write one line: fixed, or still open. Name the file and line.
3. Add each new finding. Mark it **important** or **nit**.
4. Append these lines to the note after the **Notes** section, under the heading **Changed since last review**.

If `gh` fails, report the error in the run output and do not retry with another method. A failed note write stops the run. A failed review post does not stop the run (see "Post the verdict" step 5).
