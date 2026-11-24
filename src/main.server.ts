// Server entry point: the core plus the list of apps.
//   node src/main.server.ts [--host ADDR] [--port N] [--cast ADDR --catt PATH] [--theme time] [--projects DIR]
// Arguments override config.json, which overrides the defaults (see core/server/config.ts).
import calendar from './apps/calendar/server/index.ts';
import claude from './apps/claude/server/index.ts';
import homeAssistant from './apps/home-assistant/server/index.ts';
import launcher from './apps/launcher/server/index.ts';
import lists from './apps/lists/server/index.ts';
import news from './apps/news/server/index.ts';
import photos from './apps/photos/server/index.ts';
import radio from './apps/radio/server/index.ts';
import recipes from './apps/recipes/server/index.ts';
import routines from './apps/routines/server/index.ts';
import settings from './apps/settings/server/index.ts';
import weather from './apps/weather/server/index.ts';
import { startServer } from './core/server/index.ts';

startServer([claude, weather, photos, homeAssistant, lists, calendar, routines, launcher, settings, radio, recipes, news]);
