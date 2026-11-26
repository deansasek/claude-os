// The exit code the Hub uses when it cannot listen on its address (the port is taken, or the address is not this PC's
// any more). The host (host/host.ts) does not restart on this code: a restart would fail the same way, every 30 seconds.
export const EXIT_CANNOT_LISTEN = 78;
