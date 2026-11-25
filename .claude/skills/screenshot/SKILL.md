---
name: screenshot
description: Take a screenshot of the ClaudeOS tablet and attach it to a GitHub issue, so the Claude workflows can read it. Use when a bug report needs a picture of the tablet screen.
---

# Screenshot

Use this skill when an issue needs a picture of the tablet screen, or when a fix must be checked on the screen. It takes the screenshot, asks the user to confirm, then attaches the image to the issue.

The repo is public. Anything attached is public. Before you publish, tell the user what is on the screen, and wait for a yes.

## Steps

1. Take the screenshot. Use the adb in `tools/platform-tools/adb.exe`, and read the device serial from `adb devices`. Only read the screen. Save the file in the scratchpad folder:
   `./tools/platform-tools/adb.exe -s <serial> exec-out screencap -p > <scratchpad>/<name>.png`
2. Look at the screenshot with the Read tool. List anything personal on it: the location in the weather, notification text, names, email, calendar entries. Show the user the list.
3. Ask: "Publish this screenshot to issue #<n>? It will be public." Wait for a yes. If the user says no, stop. If the user asks to crop or hide something, do that first, then ask again.
4. Attach it. The script commits the file to the `attachments` branch under the issue number, and prints a raw URL:
   `node scripts/attach-image.ts <n> <scratchpad>/<name>.png <name>.png`
5. Post the image on the issue as a comment. Write the comment to `<scratchpad>/comment.md` with the Write tool. The file holds one line that says what the screenshot shows, a blank line, and `![<short description>](<url>)` with the URL from step 4. Then run:
   `gh issue comment <n> --body-file <scratchpad>/comment.md`
6. Report the issue link. Say what the screenshot shows, and that it will be removed when the issue closes.

## Rules

- Never publish a screenshot the user has not approved.
- Never attach a file other than a PNG the skill took for this issue.
- Use the name `<short-topic>.png`, with letters, digits, dots, hyphens and underscores only.
