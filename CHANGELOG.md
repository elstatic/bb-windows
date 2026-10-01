# Changelog

## 0.3.1 — 2026-10-01

- Add native file-link menus with reveal in Windows Explorer and Windows-path copying.
- Translate WSL paths using the selected distribution and retain original-path copy, filename copy and preview.
- Validate local file availability and add renderer, CLI and SDK file actions.

## 0.3.0 — 2026-10-01

- Add official BB Connect sign-in, device pairing, owned-server selection and renewable desktop sessions.
- Encrypt cached machine credentials with Windows DPAPI and preserve the WSL browser origin.
- Add automatic stable GitHub Release updates, background downloads and installation on exit or explicit restart.
- Add native update controls and authenticated Connect/update CLI and SDK commands.
- Generate the update feed and blockmaps and support stable release publication through Windows CI.

## 0.2.0 — 2026-09-30

- Register Windows desktop browser instances through an enrolled WSL host.
- Support agent tab creation, scoped CDP control, clicks, text input and screenshots.
- Support control handoff and revocation, bridge reconnection and stale-generation rejection.
- Add WSL distribution and canonical server address options in connection settings, CLI and SDK.
- Document direct HTTPS/Tailscale connections alongside Windows SSH profiles.
- Verify the installed client on Windows and pass all 15 local unit tests and type checks.

Windows Chrome/Edge session import and BB Connect account pairing remain
unavailable. The installer is unsigned; updates are manual.

## 0.1.0 — 2026-09-30

- Add a standalone Windows x64 Electron client and per-user NSIS installer.
- Connect to an existing BB server through Windows OpenSSH or a direct HTTP(S) origin.
- Reuse BB's embedded browser, preload, search overlay, context menus and shortcuts.
- Preserve settings and browser sessions across reinstalls and upgrades.
- Add configuration CLI/SDK, isolated client builds and Windows packaging CI.
