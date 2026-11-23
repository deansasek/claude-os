// The quick replies under the conversation, picked from Claude's last message. Pure, so Node tests load it.
// A message that ends in a question gets answers to that question. Any other message gets chips for moving on.

/** [label, what gets sent]. `last` is the text of Claude's last message ('' when there is none). */
export function quickChips(last: string): [string, string][] {
  const text = last.trim();
  if (/\?["')\]]*$/.test(text)) return [['Yes', 'Yes, go ahead with that.'], ['No', 'No, leave that as it is.'], ['Tell me more', 'Tell me more before you decide.']];
  return [['Continue', 'Continue.'], ['Looks good, thanks', 'Looks good, thanks!'], ['Stop here', 'Stop here for now.']];
}
