// "Open photos", "show the calendar", "go to home assistant": which ClaudeOS app a voice phrase names.
// Pure (no browser imports), so Node tests load it (test/voice-open.test.ts). voice-commands.ts runs it on the
// normalised words (lower case, no punctuation) after every other command has had its turn, and opens the app
// with the shell's own openApp.
//
// Strict on purpose: the words after "open" / "show" / "go to" must be exactly one app name, with only "the" or "my"
// before it and "app" (or "screen", "page") after it. "open the lights" and "show the shopping list" name no app, so
// they are left to the Home Assistant and Lists commands.

/** The spoken words for each app → its id and the name said back ("Opening Photos."). Ids are the manifests'. */
const APPS: Record<string, { id: string; name: string }> = {};
function add(id: string, name: string, words: string[]): void { for (const w of words) APPS[w] = { id, name }; }
add('home', 'Home', ['home']);
add('launcher', 'Apps', ['apps', 'all apps', 'launcher', 'app list']);
add('claude', 'Claude', ['claude', 'sessions', 'session', 'usage']);
add('weather', 'Weather', ['weather', 'forecast']);
add('clock', 'Clock', ['clock', 'timer', 'timers', 'alarm', 'alarms', 'stopwatch']);
add('browser', 'Browser', ['browser', 'web browser', 'internet']);
add('camera', 'Camera', ['camera']);
add('photos', 'Photos', ['photos', 'photo', 'pictures', 'gallery']);
add('home-assistant', 'Home Assistant', ['home assistant']);
add('lists', 'Lists', ['lists', 'list']);
add('calendar', 'Calendar', ['calendar', 'diary']);
add('routines', 'Routines', ['routines', 'routine']);
add('settings', 'Settings', ['settings', 'setting']);
add('news', 'News', ['news']);
add('radio', 'Radio', ['radio']);
add('recipes', 'Recipes', ['recipes', 'recipe', 'cookbook']);
add('meals', 'Meals', ['meals', 'meal plan', 'dinners']);
add('calculator', 'Calculator', ['calculator']);
add('sketch', 'Sketch', ['sketch', 'sketchpad', 'drawing']);

const OPEN = /^(?:open(?: up)?|show(?: me)?|go to|switch to|take me to|launch)(?: the| my)? (.+?)(?: app| screen| page)?$/;

/** The app a normalised phrase asks to open, or null when the words after the verb are not exactly one app name. */
export function matchOpenApp(t: string): { id: string; name: string } | null {
  const s = t.trim().replace(/\s+/g, ' ');
  if (s === 'go home' || s === 'home screen') return APPS.home;
  const m = s.match(OPEN);
  if (!m) return null;
  return Object.prototype.hasOwnProperty.call(APPS, m[1]) ? APPS[m[1]] : null;
}
