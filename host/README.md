# ClaudeOS Host

The host runs on any OS with Node 22, through npm commands. Run them from the repository root:

```
npm run host                  start the host and keep it in the foreground (Ctrl+C stops it)
npm run host -- --port 8001   start it with extra server arguments
npm run host:status           show whether it runs and answers
npm run host:stop             stop a host that npm run host started
npm run host:logs             show the last lines of host/logs/server.log
```

It restarts the server after a crash, with a backoff of 1, 2, 5, 10 and 30 seconds. The server reads its address from `config.json`. Logs go to `host/logs/server.log` (5 MB cap, one backup).

Options: `--no-cast` turns casting off, even when `config.json` names a device. The state files are named by port, so two hosts on different ports can run side by side.

Autostart at login is not set up yet. The Windows tray app used to start the host with Windows. Until autostart is added, start the host again after a restart.
