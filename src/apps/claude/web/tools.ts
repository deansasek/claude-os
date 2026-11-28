// Plain-English names for tools. The transcript and approval cards (server/describe.ts) and the status line
// (web/words.ts) all read from here, so a tool has one name everywhere. Pure: no imports, safe on both sides.

interface ToolWords {
  now: string;                 // approval card, present tense: "Read notes.txt", "Run a command"
  past: string;                // transcript step: "Read notes.txt", "Ran a command"
  doing: string;               // status line, -ing: "Reading files"
  arg?: 'file' | 'text';       // the key argument added after the phrase: a file's name, or a search, URL or title
}

const BUILT_IN: Record<string, ToolWords> = {
  Read:          { now: 'Read', past: 'Read', doing: 'Reading files', arg: 'file' },
  Write:         { now: 'Write', past: 'Wrote', doing: 'Writing a file', arg: 'file' },
  Edit:          { now: 'Edit', past: 'Edited', doing: 'Editing', arg: 'file' },
  MultiEdit:     { now: 'Edit', past: 'Edited', doing: 'Editing', arg: 'file' },
  NotebookEdit:  { now: 'Edit notebook', past: 'Edited', doing: 'Editing a notebook', arg: 'file' },
  Bash:          { now: 'Run a command', past: 'Ran a command', doing: 'Running a command' },
  PowerShell:    { now: 'Run a command', past: 'Ran a command', doing: 'Running a command' },
  BashOutput:    { now: 'Check a command’s output', past: 'Checked a command', doing: 'Checking a command' },
  KillShell:     { now: 'Stop a command', past: 'Stopped a command', doing: 'Stopping a command' },
  TaskStop:      { now: 'Stop a task', past: 'Stopped a task', doing: 'Stopping a task' },
  Glob:          { now: 'Find files matching', past: 'Searched for', doing: 'Searching', arg: 'text' },
  Grep:          { now: 'Search files for', past: 'Searched for', doing: 'Searching', arg: 'text' },
  WebFetch:      { now: 'Read web page', past: 'Read', doing: 'Reading the web', arg: 'text' },
  WebSearch:     { now: 'Search the web for', past: 'Searched the web for', doing: 'Searching the web', arg: 'text' },
  TodoWrite:     { now: 'Update the to-do list', past: 'Updated the to-do list', doing: 'Updating the to-do list' },
  Agent:         { now: 'Start a helper', past: 'Started a helper', doing: 'Delegating' },
  Task:          { now: 'Start a helper', past: 'Started a helper', doing: 'Delegating' },
  ExitPlanMode:  { now: 'Finish planning', past: 'Finished planning', doing: 'Waiting on plan approval' },
  EnterPlanMode: { now: 'Start planning', past: 'Started planning', doing: 'Planning' },
  Skill:         { now: 'Use the skill', past: 'Used the skill', doing: 'Using a skill', arg: 'text' },
  ListMcpResources:   { now: 'List connector resources', past: 'Listed connector resources', doing: 'Listing connector resources' },
  ReadMcpResource:    { now: 'Read a connector resource', past: 'Read a connector resource', doing: 'Reading a connector resource', arg: 'text' },
  ReadMcpResourceDir: { now: 'List a connector folder', past: 'Listed a connector folder', doing: 'Listing a connector folder', arg: 'text' },
  RefreshMcpTools:    { now: 'Refresh connectors', past: 'Refreshed connectors', doing: 'Refreshing connectors' },
  // ClaudeOS's own browser tools (server/browser.ts, served as the claudeos_browser MCP server)
  'mcp__claudeos_browser__browser_open':        { now: 'Open a page in the Browser', past: 'Opened a page in the Browser', doing: 'Opening a page in the Browser' },
  'mcp__claudeos_browser__browser_back':        { now: 'Go back in the Browser', past: 'Went back in the Browser', doing: 'Going back in the Browser' },
  'mcp__claudeos_browser__browser_read_page':  { now: 'Read the page in the Browser', past: 'Read the page in the Browser', doing: 'Reading the Browser page' },
  'mcp__claudeos_browser__browser_click':       { now: 'Click in the Browser', past: 'Clicked in the Browser', doing: 'Clicking in the Browser' },
  'mcp__claudeos_browser__browser_type':        { now: 'Type in the Browser', past: 'Typed in the Browser', doing: 'Typing in the Browser' },
  'mcp__claudeos_browser__browser_screenshot':  { now: 'Take a picture of the Browser page', past: 'Took a picture of the Browser page', doing: 'Taking a picture of the Browser page' },
  // ClaudeOS's Home Assistant tools (home-assistant/server/tools.ts, the claudeos_ha MCP server)
  'mcp__claudeos_ha__ha_list_entities':  { now: 'Look at your smart home devices', past: 'Looked at your smart home devices', doing: 'Looking at your smart home devices' },
  'mcp__claudeos_ha__ha_call_service':   { now: 'Control a smart home device', past: 'Controlled a smart home device', doing: 'Controlling a smart home device' },
  'mcp__claudeos_ha__ha_activate_scene': { now: 'Set a home scene', past: 'Set a home scene', doing: 'Setting a home scene' },
  // ClaudeOS's tablet tools (server/tablet.ts, the claudeos_tablet MCP server)
  'mcp__claudeos_tablet__set_timer':    { now: 'Set a timer on the tablet', past: 'Set a timer on the tablet', doing: 'Setting a timer' },
  'mcp__claudeos_tablet__set_alarm':    { now: 'Set an alarm on the tablet', past: 'Set an alarm on the tablet', doing: 'Setting an alarm' },
  'mcp__claudeos_tablet__set_reminder': { now: 'Set a reminder on the tablet', past: 'Set a reminder on the tablet', doing: 'Setting a reminder' },
  'mcp__claudeos_tablet__notify':       { now: 'Show a notification on the tablet', past: 'Showed a notification on the tablet', doing: 'Sending a notification' },
  'mcp__claudeos_tablet__clock_status': { now: 'Check the tablet’s Clock', past: 'Checked the tablet’s Clock', doing: 'Checking the Clock' },
  'mcp__claudeos_tablet__tablet_status': { now: 'Check the tablet’s battery and Wi-Fi', past: 'Checked the tablet’s battery and Wi-Fi', doing: 'Checking the battery and Wi-Fi' },
  'mcp__claudeos_tablet__cancel_timer': { now: 'Cancel the tablet timer', past: 'Cancelled the tablet timer', doing: 'Cancelling the timer' },
  'mcp__claudeos_tablet__set_dnd': { now: 'Change Do Not Disturb', past: 'Changed Do Not Disturb', doing: 'Changing Do Not Disturb' },
  'mcp__claudeos_tablet__cancel_alarms': { now: 'Switch off Claude’s alarms', past: 'Switched off Claude’s alarms', doing: 'Switching off alarms' },
  // ClaudeOS's family lists (lists/server/tools.ts, the claudeos_lists MCP server); the card's detail is the item's text
  'mcp__claudeos_lists__lists_read': { now: 'Read the family lists', past: 'Read the family lists', doing: 'Reading the lists' },
  'mcp__claudeos_lists__lists_add':  { now: 'Add to a family list', past: 'Added to a family list', doing: 'Adding to a list' },
  'mcp__claudeos_lists__lists_tick': { now: 'Tick off a list item', past: 'Ticked off a list item', doing: 'Ticking off a list item' },
  'mcp__claudeos_lists__lists_remove': { now: 'Remove a list item', past: 'Removed a list item', doing: 'Removing a list item' },
  'mcp__claudeos_lists__lists_edit': { now: 'Change a list item', past: 'Changed a list item', doing: 'Changing a list item' },
  'mcp__claudeos_lists__lists_new': { now: 'Make a new list', past: 'Made a new list', doing: 'Making a new list' },
  'mcp__claudeos_lists__lists_rename': { now: 'Rename a list', past: 'Renamed a list', doing: 'Renaming a list' },
  'mcp__claudeos_lists__lists_clear_done': { now: 'Clear ticked list items', past: 'Cleared ticked list items', doing: 'Clearing ticked list items' },
  // ClaudeOS's calendar (calendar/server/tools.ts, the claudeos_calendar MCP server), read-only
  'mcp__claudeos_calendar__calendar_today': { now: 'Look at your calendar', past: 'Looked at your calendar', doing: 'Looking at your calendar' },
  'mcp__claudeos_calendar__calendar_range': { now: 'Look at your calendar', past: 'Looked at your calendar', doing: 'Looking at your calendar' },
  // ClaudeOS's News (news/server/tools.ts, the claudeos_news MCP server), read-only
  'mcp__claudeos_recipes__recipes_search': { now: 'Search recipes', past: 'Searched recipes', doing: 'Searching recipes' },
  'mcp__claudeos_news__news_topics': { now: 'Check the news topics', past: 'Checked the news topics', doing: 'Checking the news topics' },
  'mcp__claudeos_news__news_headlines': { now: 'Read the headlines', past: 'Read the headlines', doing: 'Reading the headlines' },
  // ClaudeOS's Meals (meals/server/tools.ts, the claudeos_meals MCP server), read-only
  'mcp__claudeos_meals__meals_week': { now: 'Look at the dinner plan', past: 'Looked at the dinner plan', doing: 'Looking at the dinner plan' },
  'mcp__claudeos_meals__meals_plan': { now: 'Plan a dinner', past: 'Planned a dinner', doing: 'Planning a dinner' },
  // ClaudeOS's weather (weather/server/tools.ts, the claudeos_weather MCP server), read-only
  'mcp__claudeos_weather__weather_forecast': { now: 'Look at the weather', past: 'Looked at the weather', doing: 'Looking at the weather' },
  // ClaudeOS's routines (routines/server/tools.ts, the claudeos_routines MCP server)
  'mcp__claudeos_routines__run_routine': { now: 'Run a routine on the tablet', past: 'Ran a routine on the tablet', doing: 'Running a routine' },
  AskUserQuestion: { now: 'Ask you a question', past: 'Asked you a question', doing: 'Asking you something' },
  TaskCreate:    { now: 'Add a task', past: 'Added a task', doing: 'Adding a task', arg: 'text' },
  TaskUpdate:    { now: 'Update a task', past: 'Updated a task', doing: 'Updating a task', arg: 'text' },
  TaskGet:       { now: 'Look at a task', past: 'Looked at a task', doing: 'Looking at a task', arg: 'text' },
  TaskList:      { now: 'List tasks', past: 'Listed tasks', doing: 'Listing tasks' },
  CronCreate:    { now: 'Schedule a task', past: 'Scheduled a task', doing: 'Scheduling a task', arg: 'text' },
  CronDelete:    { now: 'Cancel a scheduled task', past: 'Cancelled a scheduled task', doing: 'Cancelling a scheduled task' },
  CronList:      { now: 'List scheduled tasks', past: 'Listed scheduled tasks', doing: 'Listing scheduled tasks' },
  ScheduleWakeup: { now: 'Schedule a check-in', past: 'Scheduled a check-in', doing: 'Scheduling a check-in' },
};

/** "search_threads" → "search threads", "searchThreads" → "search threads" */
const plain = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ').trim().toLowerCase();
const sentence = (s: string): string => (s.charAt(0).toUpperCase() + s.slice(1));

/** A connector's id (a UUID) has no name to show. */
const isConnectorId = (s: string): boolean => /^[0-9a-f-]{20,}$/i.test(s);

/** "mcp__claude_ai_Gmail__search_threads" → "Gmail · search threads" (a connector id shows as "Connector"). */
function connectorLabel(tool: string): string {
  const [, server = '', ...rest] = tool.split('__');
  const name = rest.join('__');
  const who = isConnectorId(server) ? 'Connector' : sentence(plain(server.replace(/^claude_ai_/, '')));
  return `${who} · ${plain(name) || 'use a tool'}`;
}

/** The names for a tool: a built-in one from the table above, a connector's, or the tool's own name in words. */
export function wordsFor(tool: string): ToolWords {
  if (BUILT_IN[tool]) return BUILT_IN[tool];
  if (tool.startsWith('mcp__')) {
    const label = connectorLabel(tool);
    return { now: label, past: label, doing: `Using ${label}` };
  }
  const words = sentence(plain(tool)) || 'A tool';
  return { now: words, past: words, doing: `Using ${plain(tool) || 'a tool'}` };
}
