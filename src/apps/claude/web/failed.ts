// The one sentence the screen says when a reply did not finish. Shared by the tablet chat (native-stream.ts) and the
// PC hub (server/turns.ts). Pure: no DOM, no node imports. The raw reason goes to the console, not the screen.

/** The assistant error codes the SDK sends (SDKAssistantMessage.error), and what each one says. */
const CODES: Record<string, string> = {
  authentication_failed: 'Sign in again under Settings → Apps → Claude.',
  billing_error: 'This account can’t run Claude right now. Check the account, then try again.',
  rate_limit: 'Claude hit a limit. Wait a while, then try again.',
  overloaded: 'Claude is busy right now. Try again in a minute.',
  model_not_found: 'That model isn’t available. Pick another model and try again.',
  invalid_request: 'Claude couldn’t use that request. Try again with different wording.',
  max_output_tokens: 'The reply ran too long to finish. Ask for a shorter answer.',
  server_error: 'Claude had a problem on its side. Try again.',
};

/** The result subtypes the SDK and the CLI send when a turn stops early. */
const SUBTYPES: Record<string, string> = {
  error_max_turns: 'Claude ran out of steps before it finished. Ask it to carry on.',
  prompt_too_long: 'This chat is too long for Claude to read. Start a new chat.',
};

const DEFAULT = 'That reply didn’t finish. Try again.';

/** The sentence for a failed reply. `reason` is an assistant error code or a result subtype (null when unknown). */
export function failedSentence(reason: string | null | undefined): string {
  return (reason && (CODES[reason] || SUBTYPES[reason])) || DEFAULT;
}
