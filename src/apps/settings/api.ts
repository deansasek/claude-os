// Settings' shared shapes (web and server): the profile, kept on this PC (see server/profile.ts).
//   GET  /api/settings/profile            the profile
//   POST /api/settings/profile            {name?, nickname?, role?}: any of them, the ones sent are saved
//   POST /api/settings/photo              the profile photo: raw JPEG bytes, square, up to PHOTO_MAX
//   POST /api/settings/photo/remove       take the photo away (initials show again)
//   GET  /api/settings/photo?v=…          the photo itself (v is photoAt, to bust the cache)
//   GET  /api/settings/instructions       "Your Claude": {text}
//   POST /api/settings/instructions       {text}: saved (empty clears it), returns {text}
//   GET  /api/settings/storage            what the PC keeps for ClaudeOS: {photos} in bytes
//   GET  /api/settings/pin                the ClaudeOS PIN lock: PinStatus {set, lockedFor}
//   POST /api/settings/pin/check          {pin}: PinResult (the lock screen's check)
//   POST /api/settings/pin                {pin, current?}: set or change it (current is needed once one is set)
//   POST /api/settings/pin/remove         {pin}: remove it (the current PIN)
//   GET  /api/settings/welcome            {done}: the first-run welcome has been finished or skipped
//   POST /api/settings/welcome            {done}: true when finished or skipped; false shows it again

export interface Profile {
  name: string;        // Full name
  nickname: string;    // What Claude should call the user
  role: string;        // One of ROLES, or '' when not set
  photoAt: number;     // when the photo was saved (ms), 0 when there is none
}

export const NAME_MAX = 60;
export const NICK_MAX = 30;
export const PHOTO_MAX = 512 * 1024;
export const INSTRUCTIONS_MAX = 4000;

// The ClaudeOS PIN lock (server/pin.ts). 4 to 6 digits; 5 wrong tries give a 30-second cooldown.
export interface PinStatus { set: boolean; lockedFor: number }   // lockedFor: seconds of cooldown left
export type PinError = 'bad_pin' | 'wrong' | 'locked' | 'no_pin' | 'save_failed';
export interface PinResult {
  ok: boolean;
  set?: boolean;        // the state after a set, change or remove
  lockedFor: number;    // seconds of cooldown (0 when none)
  left?: number;        // wrong tries left before the cooldown (after a wrong try)
  error?: PinError;
}

/** What best describes your work. Listed in this order, "Other" last. */
export const ROLES = [
  'Design', 'Finance', 'Marketing', 'Operations', 'Product', 'Sales',
  'Legal', 'Scientist', 'Student', 'Founder', 'Healthcare', 'Writer', 'Educator', 'Consultant',
  'Researcher', 'Software engineer', 'Other',
] as const;

// Plugins (Settings → Plugins): what this PC's Claude Code has, and which of it ClaudeOS sessions use.
//   GET  /api/settings/plugins?project=<id>&fresh=1   PluginsView
//   POST /api/settings/plugins/toggle                 {key, on}: a switch (applies from the next message)
//   POST /api/settings/plugins/mcp                    McpInput: add a server for ClaudeOS sessions
//   POST /api/settings/plugins/mcp/remove             {name}: remove one of those
//   POST /api/settings/plugins/test                   {name, project?}: check one MCP server now
//   POST /api/settings/plugins/folder                 {path}: add a local plugin folder; /folder/remove {path}
// Secrets never appear in these shapes: env and header values are only ever counted.
export type PluginKind = 'connector' | 'mcp' | 'skill' | 'plugin';
export type PluginStatus = 'connected' | 'pending' | 'needs-auth' | 'failed' | 'disabled' | 'ok' | 'missing' | 'unknown';

export interface PluginItem {
  key: string;           // 'mcp:<name>' | 'skill:<name>' | 'plugin:<id>' (a folder: 'plugin:path:<folder>')
  kind: PluginKind;
  name: string;
  subtitle: string;      // "Connector · claude.ai", "Custom MCP · stdio", "Skill · user", "Plugin · marketplace"
  description: string;
  source: string;        // where it comes from (a path or a label); never a secret
  detail: string[];      // short lines for the detail sheet, e.g. "Runs: npx", "2 env vars (values hidden)"
  status: PluginStatus;
  tools: number | null;  // how many tools a connected server offers
  error: string | null;
  on: boolean;           // on for the sessions ClaudeOS runs
  custom: boolean;       // added in ClaudeOS: can be removed here
}

export interface PluginsView {
  items: PluginItem[];
  project: { id: string; name: string } | null;   // the folder the MCP files and skills were read from
  probe: { at: number; error: string | null; pending: boolean } | null;   // when the live check ran
}

// Discover (Settings → Plugins → Discover): the Anthropic plugin marketplace, installed through the Claude Code CLI.
//   GET  /api/settings/plugins/market             MarketView: the plugins the marketplace lists
//   POST /api/settings/plugins/market/install     {name, marketplace}: MarketResult (installs for the user, all sessions)
//   POST /api/settings/plugins/market/uninstall   {name, marketplace}: MarketResult
//   POST /api/settings/plugins/market/refresh     MarketResult: checks the marketplace for updates
export const MARKETPLACE = 'claude-plugins-official';

export interface MarketPlugin {
  name: string;
  description: string;
  author: string;
  category: string;      // "" when the marketplace doesn't say
  keywords: string[];
  version: string | null;   // from the plugin's own manifest, when it's on this PC
  homepage: string | null;  // an https address, without its query string
  from: string | null;      // the host a plugin is fetched from (when it isn't bundled with the marketplace)
  parts: string[];          // "3 skills", "hooks", "2 MCP servers"… (bundled plugins only; [] otherwise)
  installed: boolean;
}

export type MarketError = 'no_marketplace' | 'bad_marketplace' | 'bad_name' | 'not_in_marketplace' | 'not_installed'
  | 'needs_confirm' | 'no_cli' | 'timeout' | 'failed' | 'network';

export interface MarketView {
  marketplace: string;
  updatedAt: string | null;   // when the marketplace was last updated (ISO), if known
  plugins: MarketPlugin[];
  error: 'no_marketplace' | null;
}

export interface MarketResult {
  ok: boolean;
  error: MarketError | null;
  output: string;           // the tail of the CLI's own output (ANSI codes removed)
}

/** The Add MCP server sheet. env and headers are typed as "KEY=value; KEY=value". */
export interface McpInput {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string;
  url?: string;
  env?: string;
  headers?: string;
}
