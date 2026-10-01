# Changelog

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
