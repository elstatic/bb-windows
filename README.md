# BB Windows

[![Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D4)](https://github.com/elstatic/bb-windows/releases/tag/v0.3.1)
[![MIT license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Windows build](https://github.com/elstatic/bb-windows/actions/workflows/build-windows-client.yml/badge.svg)](https://github.com/elstatic/bb-windows/actions/workflows/build-windows-client.yml)

A Windows desktop client for [BB](https://github.com/get-bb/bb), the agentic IDE.
Connect to your existing server, work with agents, and let them control browser
tabs on your Windows machine through an enrolled WSL host.

[Download 0.3.1](https://github.com/elstatic/bb-windows/releases/tag/v0.3.1) ·
[Setup & technical details](apps/windows-client/README.md) ·
[Русский](README.ru.md) · [Contributing](CONTRIBUTING.md)

> Early release. The installer is unsigned; stable releases update automatically.

## What you get

| Feature | Behavior |
| --- | --- |
| Windows file actions | Reveal a local file in Explorer and copy its Windows/WSL path |
| Windows installer | Per-user installation, Start menu and desktop shortcuts |
| BB Connect | Account sign-in, device pairing and owned-server selection |
| Automatic updates | Stable GitHub Releases, background downloads, install on exit |
| Direct connection | HTTP(S) connection to a BB server, including a Tailscale Serve address |
| SSH connection | Uses your Windows OpenSSH profile; reconnects after interruptions |
| Embedded browser | Electron browser tabs with persistent sessions |
| Agent browser control | Open tabs, click, type, inspect pages and take screenshots through the WSL host |
| Control handoff | Scoped, expiring access; **Take over** returns control to you |
| Desktop integration | Native menus, shortcuts, search overlay, context menus and multiple windows |

The client reuses BB's interface and desktop browser components. The server,
providers and agent execution stay on your existing BB infrastructure. The
installer does not bundle a BB server or host daemon.

## Install and connect

1. Download [BB-Windows-0.3.1-x64-Setup.exe](https://github.com/elstatic/bb-windows/releases/download/v0.3.1/BB-Windows-0.3.1-x64-Setup.exe).
2. Run the installer and launch **BB Windows**. Windows may show a warning because the installer is unsigned.
3. Choose **BB Connect**, sign in and select your server, or choose **Адрес сервера** and enter the BB origin, such as `https://bb.example.com/`. A reachable Tailscale Serve HTTPS address works directly.
4. If the server is reachable only through SSH, choose **SSH-туннель** and select a configured Windows OpenSSH profile instead.

The [release](https://github.com/elstatic/bb-windows/releases/tag/v0.3.1) includes
SHA256 checksums. Installing a newer version over the existing one preserves
settings and browser sessions. Open **BB → Подключение…** to change the server.

### Enable agent browser control

You need an enrolled local WSL daemon connected to the same BB server, and
Node.js 22.19+ in that distribution. The client uses the default WSL distribution;
you can select another in connection settings. When using SSH or an alternate
server address, also provide the canonical server address used for WSL enrollment.

The bridge uses local process pipes and loopback connections. New agent tabs
have separate automation profiles; controlling a personal tab requires an
explicit handoff. You can revoke control at any time.

See [browser setup and CLI/SDK usage](apps/windows-client/README.md#browser-control-and-tailscale).
Manual browsing and the remote interface work without a local WSL daemon.

## Automatic updates

Starting with 0.3, stable GitHub releases download automatically and install on exit.
Use **BB → Проверить обновления…** or **Перезапустить и обновить**.
[Publisher instructions and CLI/SDK](apps/windows-client/README.md#automatic-updates).

## Current limits

- Importing signed-in sessions from Windows Chrome/Edge is not implemented. Sign in inside the embedded browser.
- Installers are unsigned. Versions 0.1/0.2 need one manual upgrade to enable automatic updates.
- Native Windows agent/provider execution is outside this client. Local agents use WSL.

## Build from source

Use Node.js 24 on Windows. From the repository root:

```powershell
npm ci --prefix apps/windows-client --ignore-scripts
$env:PATH = "$pwd/apps/windows-client/node_modules/.bin;$env:PATH"
& "$pwd/apps/windows-client/node_modules/.bin/turbo.cmd" run build typecheck test --filter=@bb/windows-client
& "$pwd/apps/windows-client/node_modules/.bin/turbo.cmd" run package:win --filter=@bb/windows-client
```

The installer appears in `apps/windows-client/release`. Source builds and unit
checks also run on Linux/WSL; installer packaging runs on Windows.
[Windows CI](https://github.com/elstatic/bb-windows/actions/workflows/build-windows-client.yml)
builds, checks and packages the client. Upstream publishing and deployment
workflows are archived in `.github/upstream-workflows`.

## Project and license

This is an independent Windows client based on [get-bb/bb](https://github.com/get-bb/bb),
with the upstream source and history retained. The client lives in
[`apps/windows-client`](apps/windows-client). The upstream MIT license and
Michael Yong's copyright notice are preserved in [LICENSE](LICENSE).

[Changelog](CHANGELOG.md) · [Report a bug](https://github.com/elstatic/bb-windows/issues/new?template=bug.yml) ·
[Request a feature](https://github.com/elstatic/bb-windows/issues/new?template=feature.yml)
