# BB Windows

Windows x64 Electron client for an existing BB server. The interface and all
agent execution remain on the selected server and its enrolled machines.
This package reuses BB's desktop preload, embedded browser, search overlay,
context menus, shortcuts and shared contracts. It ships no local BB server,
host daemon, provider CLI, SQLite add-on or node-pty.

## Install

Run `BB-Windows-0.3.1-x64-Setup.exe`. Installation is per user. Start **BB Windows**
from the Start menu or desktop. Node.js and WSL are not needed to run this client;
WSL remains necessary for local agent execution through an enrolled WSL host.

On first launch, choose an existing Windows OpenSSH profile or a direct server
origin. The default profile is `nuc-clawd`, with local port `38896` and server port
`38886`. Open **BB → Подключение…** to change it. SSH uses the current user's
configuration and keys, with batch authentication and normal host-key checks.
Set up and test the SSH profile before using it in BB Windows.

The client borrows a healthy existing tunnel without terminating it on exit.
Otherwise it starts and owns one hidden SSH process. It checks the connection
every 15 seconds and after Windows resumes. Occupied ports and authentication
errors appear in the connection screen. An occupied port is used only if both
BB's health endpoint and system configuration validate.

The client stores settings, window placement, browser sessions and `client.log`
under `%APPDATA%\BB Windows`. Removing the application preserves this directory.
The server and WSL daemon have independent lifecycles.

## Browser control and Tailscale

If Windows can reach the server through Tailscale Serve, select **Адрес сервера**
and enter its HTTPS origin. This is the same direct HTTP/WebSocket connection
used by the upstream desktop custom-server mode. It requires Tailscale on Windows
and server-side access configured; the installer does not expose the server.
SSH remains useful for a server available only on its own loopback interface.

The client registers native windows with the existing enrolled WSL host daemon.
It uses the default WSL distribution, or the distribution selected in connection
settings. Node.js 22.19+ must be available in that distribution; nvm installs are
supported. The daemon's private descriptor must belong to the same WSL user and
match the chosen server origin. For SSH or an alternate server URL, set the
browser host's server address to the canonical address used for WSL enrollment.
Without an enrolled WSL daemon, manual browsing still works.

Windows and WSL loopback addresses are different under WSL's default NAT mode.
A bundled helper forwards the authenticated broker and scoped CDP connections
through inherited process pipes. CDP listeners stay on WSL loopback, credentials
stay local, and only issued, unexpired native browser ports can be forwarded.
No firewall rule, LAN listener or daemon protocol change is needed. Closing the
client or disconnecting the host revokes control and closes the bridge. Existing
personal tabs need an explicit control handoff; new agent tabs use isolated
profiles. **Забрать управление** revokes the lease.

Use the existing `bb browser` CLI and
`bb.sdk.experimental_desktopBrowsers` SDK:

```sh
bb browser instances --host <wsl-host-id> --json
bb guide browser
```

The command output supplies the instance and generation used for `tabs`,
`create`, `acquire`, `connection`, `release`, `capture` and `close`. CDP connection
files are private and usable on the WSL browser host. Browser Automation can use
these same desktop instances. Browser host options are also available through
the configuration CLI and SDK:

```json
{"kind":"direct","url":"https://bb.example.com/","browserHost":{"distribution":"Ubuntu"}}
```

```json
{"kind":"ssh","profile":"bb","localPort":38896,"remotePort":38886,"browserHost":{"distribution":"Ubuntu","serverUrl":"https://bb.example.com/"}}
```

## Build

Use Node.js 24 on Windows and run these commands from the repository root:

```powershell
npm ci --prefix apps/windows-client --ignore-scripts
$env:PATH = "$pwd/apps/windows-client/node_modules/.bin;$env:PATH"
& "$pwd/apps/windows-client/node_modules/.bin/turbo.cmd" run build typecheck test --filter=@bb/windows-client
& "$pwd/apps/windows-client/node_modules/.bin/turbo.cmd" run package:win --filter=@bb/windows-client
```

The installer is emitted into `apps/windows-client/release`. Packaging runs on
Windows; building sources and running the unit checks also work on Linux. The
separate npm lockfile supports installing only this package's tooling without
installing the BB server's native dependencies. A build-time dependency check
rejects bundles that accidentally include the server or its native runtime.

`.github/workflows/build-windows-client.yml` builds and checks the installer on
a Windows runner and uploads an artifact. An optional `release_tag` workflow input publishes a stable release with its update feed.

## CLI and SDK

For setup scripts, build the package and run:

```powershell
node apps/windows-client/dist/cli.cjs show --file "$env:APPDATA\BB Windows\connection.json"
node apps/windows-client/dist/cli.cjs set --file "$env:APPDATA\BB Windows\connection.json" --input connection.json
```

`dist/client-sdk.cjs` exports `connectionSchema`, `readConnection`,
`saveConnection`, `connectionUrl` and `DEFAULT_CONNECTION` for Node setup tools.
The CLI and SDK validate the same settings as the desktop UI. Restart the
application after a CLI or SDK settings change.

Configuration examples:

```json
{"kind":"ssh","profile":"nuc-clawd","localPort":38896,"remotePort":38886}
```

```json
{"kind":"direct","url":"https://bb.example.com/"}
```

## Verification and current limits

The unit suite covers tunnel ownership, occupied ports, incompatible services,
SSH failure, reconnection, cancellation, input validation and saved settings.
Types are checked against the reused BB desktop components. The build includes
a CSP hash for the connection dialog's script and isolates all renderer code.

For a packaged Windows smoke test, pass `--smoke-output=C:\path\result.json`.
After connecting, the app verifies its desktop API, BB health, system config
and loaded UI, saves JSON plus a screenshot and exits. `--smoke-delay-ms=22000`
allows testing a connection interruption before the snapshot.

`scripts/verify-installed.ps1 -Installer <installer.exe> -SshProfile <profile>`
runs the installer lifecycle and real SSH reconnection checks on a Windows test
machine with a saved connection. It installs, uninstalls and reinstalls this
client, temporarily uses port `38906`, and writes a verification report into a
new temporary directory. It restores the original connection settings.

Version 0.3.0 adds BB Connect account sign-in, device-code pairing, server selection
and renewable desktop sessions. Machine credentials use Windows DPAPI encryption.
Direct HTTPS/Tailscale and SSH remain available. Native Windows browser session
import is not implemented; agent control requires an enrolled WSL host.

## BB Connect

Choose **BB Connect** in **BB → Подключение…**, sign in through the official
Connect dashboard and select an owned server. You can also paste a one-time
device code. For an existing direct/SSH connection, **Подключить текущий сервер**
requests a device code from that authenticated server and switches this client
to Connect. The canonical WSL server origin is retained for browser control.
Closing the sign-in window without signing in preserves an existing pairing.

The running client exposes authenticated local SDK/CLI commands:

```powershell
node apps/windows-client/dist/cli.cjs connect status --data-dir "$env:APPDATA\BB Windows"
node apps/windows-client/dist/cli.cjs connect list --data-dir "$env:APPDATA\BB Windows"
node apps/windows-client/dist/cli.cjs connect sign-in --data-dir "$env:APPDATA\BB Windows"
node apps/windows-client/dist/cli.cjs connect bootstrap --data-dir "$env:APPDATA\BB Windows"
node apps/windows-client/dist/cli.cjs connect pair --data-dir "$env:APPDATA\BB Windows" --input private-code.txt
node apps/windows-client/dist/cli.cjs connect logout --data-dir "$env:APPDATA\BB Windows"
```

`--base-url` selects a compatible Connect service for list/sign-in/pair/logout;
it defaults to `https://getbb.app/`. `bootstrap` uses the current authenticated
server. Pairing codes belong in a private file, never a shell command argument.
The SDK exports `requestClientControl`, `connectActionSchema` and `clientActionSchema`.
Responses contain server metadata and session status, never credentials.

## Automatic updates

Installed Windows clients check this fork's stable GitHub Releases shortly after
launch, every six hours and after resume. Updates download in the background;
SHA512 verification must succeed before installation is available. The native
**BB** menu and BB desktop API expose check/status/install actions. A downloaded
update installs on normal exit, or **Перезапустить и обновить** installs and
relaunches immediately. Settings, pairing and browser sessions are preserved.
Development builds do not download or install updates. Prereleases and downgrades
are excluded. Version 0.1/0.2 users must install 0.3 once manually.

```powershell
node apps/windows-client/dist/cli.cjs update status --data-dir "$env:APPDATA\BB Windows"
node apps/windows-client/dist/cli.cjs update check --data-dir "$env:APPDATA\BB Windows"
node apps/windows-client/dist/cli.cjs update install --data-dir "$env:APPDATA\BB Windows"
```

SDK: `requestClientControl(dataDir, { action: "update-check" })`, `update-status`
and `update-install`. The remote BB API also supports `bbDesktop.checkForUpdates()`,
`getInfo()`, `installUpdate()` and `onChange()`.

To publish an update, bump `apps/windows-client/package.json` and its npm lockfile,
push the commit and a matching `vX.Y.Z` tag, then run the Windows workflow with
`release_tag=vX.Y.Z`. It validates, builds and uploads the installer, blockmap,
`latest.yml` and checksums into a draft, then publishes it as a stable release.
A build without `release_tag` produces artifacts only. Existing release tags
are not overwritten. The installer is unsigned; HTTPS and hash verification
protect transport and integrity, not publisher identity.

The fork is based on upstream commit
`36aacc040ec0a2b092785d65dee7869d02cec08e` and retains the upstream MIT license.

## Windows file actions

Right-click an absolute file link in a message to use **Показать в проводнике**
and **Копировать путь для Windows**. The Windows client supplies this native
menu while retaining preview, original-path copy and filename copy.
`/mnt/c/...` resolves to `C:\...`; Linux files resolve through the selected WSL
distribution to `\\wsl.localhost\<distribution>\...`. Paths are passed directly
to `wslpath` without shell interpolation. Spaces, Unicode and file-link line
locations are supported. Both actions check local availability first; a file
that exists only on a remote machine must be downloaded or mounted locally.
The original source path remains available separately.

```powershell
node apps/windows-client/dist/cli.cjs file resolve --data-dir "$env:APPDATA\BB Windows" --path "/home/me/report.md"
node apps/windows-client/dist/cli.cjs file copy --data-dir "$env:APPDATA\BB Windows" --path "/mnt/c/work/report.md"
node apps/windows-client/dist/cli.cjs file reveal --data-dir "$env:APPDATA\BB Windows" --path "C:\work\report.md"
```

SDK: `requestClientControl(dataDir, { action: "file-reveal", path })`,
`file-copy` and `file-resolve`; all return `{ sourcePath, windowsPath }`.
Trusted BB renderers can also use `window.bbWindowsFiles.resolve(path)`,
`copy(path)` and `reveal(path)`. Browser tabs do not receive this bridge.
