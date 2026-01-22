# node-pty FD Leak Reproduction

Demonstrates that `node-pty` leaks one `/dev/ptmx` file descriptor per spawn, even after the child process exits naturally.

## The Issue

Each call to `pty.spawn()` leaks 1 PTY master file descriptor (`/dev/ptmx`). This happens even when:
- The child process exits normally
- The `onExit` callback fires
- Sufficient time passes for internal cleanup

Over time (after hundreds of spawns), this leads to `posix_spawnp failed` errors.

## Reproduction

```bash
node repro.js
```

Or manually:
```bash
# Watch ptmx FDs while running node
lsof -p <PID> | grep ptmx
```

## Expected Output

```
Initial state: 0 ptmx FDs, 31 total FDs

After 5 spawns: 5 ptmx FDs leaked
After 10 spawns: 10 ptmx FDs leaked
...

❌ FD LEAK CONFIRMED

Each spawn leaks 1 /dev/ptmx file descriptor.
Over time, this leads to: "posix_spawnp failed" errors
```

## Root Cause

Looking at `node-pty/src/unix/pty.cc`, the `pty_posix_spawn` function on macOS:
1. Opens PTY master via `posix_openpt(O_RDWR)` (line 746)
2. Also opens low_fds for FD < 3 handling (lines 736-740)
3. The low_fds are closed (line 820-822), but there may be a race or the main master FD isn't being closed

In `node-pty/src/unixTerminal.ts`:
- `onexit` callback destroys the socket after 200ms timeout
- But this only closes the `tty.ReadStream` socket, not the underlying PTY master FD directly

## Related

- Original issue: https://github.com/github/copilot-cli/issues/677
- The `destroy()` method exists and properly cleans up, but is NOT in the public `IPty` interface

