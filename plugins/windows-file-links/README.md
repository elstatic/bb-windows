# Windows File Links

A BB plugin for the [BB Windows client](https://github.com/elstatic/bb-windows). Adds Explorer and Windows clipboard actions to file-link context menus without modifying upstream BB.

Files are resolved against their actual thread-storage host or the current thread environment. Local files use the native Windows bridge. Remote files are copied on demand into this plugin's private cache on the selected Windows WSL browser host. Cache directory names use 128 bits of the source identity hash to keep Windows paths short. Each transfer is size-limited to 32 MiB and SHA-256 verified. Repeat actions refresh the cached file from the source. This is a local viewing copy, not two-way synchronization.

Optional `mappings` settings contain a JSON array of `{sourceHostId, clientHostId, sourceRoot, localRoot}`; roots use absolute paths on their respective Linux/WSL hosts. A matching synchronized file is reused only when its content matches the source. Missing or stale local files fall back to a downloaded copy; local edits are never overwritten. Windows drives can be addressed through `/mnt/c/...`. Thread storage is separate from project folder synchronization.

## Install

```sh
bb plugin install git:https://github.com/elstatic/bb-windows.git --subdirectory plugins/windows-file-links --yes
```

Requires BB >=0.44, Plugin SDK >=0.5.29, and BB Windows >=0.3.1 with its local browser host configured. Browser-only BB clients keep their regular menus. Disabling the plugin restores the client's existing menu. The native wrapper only supplies clipboard, WSL path conversion and Explorer primitives; this plugin owns remote resolution and menu behavior.

## SDK and CLI

RPC `prepare` accepts `{path, threadId, clientHostId}` and returns `{path, source: "original" | "synced" | "downloaded"}`. Absolute paths are restricted to the selected thread workspace or the storage root identified by the path's thread ID.

```sh
bb windows-file-links prepare /home/clawd/.bb/thread-storage/thr_example/reports/report.html thr_example host_windows --json
bb plugin config windows-file-links
```

The resulting Linux/WSL path is passed to the native client's `bbWindowsFiles.copy()` or `.reveal()` bridge to obtain the actual Windows path. HTML preview remains BB's existing server-aware preview; downloaded HTML may require separately copying sibling assets when opened outside BB.

## Development

```sh
npm ci
bb plugin build .
npm run typecheck
npm test
```

MIT, see the repository's LICENSE.
