# Windows File Links

A BB plugin for the official BB Windows desktop and the [BB Windows client](https://github.com/elstatic/bb-windows). Adds Explorer and Windows clipboard actions to file-link context menus without modifying upstream BB.

Files are resolved against their actual thread-storage host or the current thread environment. Local files use the native Windows bridge. Remote files are copied on demand into this plugin's private cache on the selected Windows WSL browser host. Cache directory names use 128 bits of the source identity hash to keep Windows paths short. Each transfer is size-limited to 20 MiB and SHA-256 verified. Repeat actions refresh the cached file from the source. This is a local viewing copy, not two-way synchronization.

Optional `mappings` settings contain a JSON array of `{sourceHostId, clientHostId, sourceRoot, localRoot}`; roots use absolute paths on their respective Linux/WSL hosts. A matching synchronized file is reused only when its content matches the source. Missing or stale local files fall back to a downloaded copy; local edits are never overwritten. Windows drives can be addressed through `/mnt/c/...`. Thread storage is separate from project folder synchronization.

## Install

```sh
bb plugin install git:https://github.com/elstatic/bb-windows.git --subdirectory plugins/windows-file-links --yes
```

Requires a Windows desktop and an enrolled native Windows or WSL host. Set `clientHostId` to your local Windows/WSL machine ID if the desktop browser target is unavailable. Browser-only BB clients keep their regular menus. Adds actions to BB's existing file menu, preserving Download, Open in, and original copy actions. Disabling the plugin removes only its added items. Existing files on the selected local host can be opened outside the current project folder. Remote transfers are confined to the thread workspace or storage root. Host-side plugin code performs Windows clipboard, WSL path conversion and Explorer operations through PowerShell. No custom preload bridge or patched desktop is required.

## SDK and CLI

RPC `client` reads the configured fallback host. RPC `action` accepts `{path, threadId, clientHostId, action: "copy" | "reveal" | "resolve"}` and returns `{windowsPath}`. RPC `prepare` accepts `{path, threadId, clientHostId}` and returns `{path, source: "original" | "synced" | "downloaded"}`. Absolute paths are restricted to the selected thread workspace or the storage root identified by the path's thread ID.

```sh
bb windows-file-links prepare /home/clawd/.bb/thread-storage/thr_example/reports/report.html thr_example host_windows --json
bb plugin config windows-file-links
```

CLI commands `copy`, `reveal`, and `resolve` use the same arguments as `prepare` and invoke the plugin's Windows actions. HTML preview remains BB's existing server-aware preview; downloaded HTML may require separately copying sibling assets when opened outside BB.

## Development

```sh
npm ci
bb plugin build .
npm run typecheck
npm test
```

MIT, see the repository's LICENSE.
