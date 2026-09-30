# BB Windows

Windows x64 Electron client for an existing BB server. The interface and all
agent execution remain on the selected server and its enrolled machines.
This package reuses BB's desktop preload, embedded browser, search overlay,
context menus, shortcuts and shared contracts. It ships no local BB server,
host daemon, provider CLI, SQLite add-on or node-pty.

## Install

Run `BB-Windows-0.1.0-x64-Setup.exe`. Installation is per user. Start **BB Windows**
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
a Windows runner and uploads an artifact. It does not publish a release.

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

The initial release uses manual installer updates, preserving settings. It
does not subscribe to upstream macOS/Linux update feeds. The installer is
unsigned. Agent control of the embedded Windows browser, browser cookie import
and BB Connect account pairing are outside this initial client release; the
embedded browser supports manual browsing. Connect using an SSH tunnel or a
direct reachable BB origin.

The fork is based on upstream commit
`36aacc040ec0a2b092785d65dee7869d02cec08e` and retains the upstream MIT license.
