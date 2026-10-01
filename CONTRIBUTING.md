# Contributing to BB Windows

Issues and pull requests are welcome. No contributor approval or Discord
membership is required for this repository.

## Report a problem

Use the [bug report form](https://github.com/elstatic/bb-windows/issues/new?template=bug.yml).
Include the BB Windows and server versions, Windows version, connection mode,
WSL distribution when relevant, reproduction steps, and expected/actual behavior.
Useful client logs are in `%APPDATA%\BB Windows\client.log`.
Remove credentials and personal information from logs and screenshots. Never
attach SSH keys, browser cookies or private CDP connection files.

For feature requests, describe the workflow and the behavior you need. Discuss
large changes in an issue before spending time on implementation.

## Development

The standalone client lives in `apps/windows-client`. It reuses browser,
preload and desktop components from `apps/desktop` and shared contracts from
`packages`. The server and host daemon stay separate.

Use Node.js 24. See the [client README](apps/windows-client/README.md#build) for
Windows build/package commands. On Linux/WSL, from the repository root:

```sh
npm ci --prefix apps/windows-client --ignore-scripts
PATH="$PWD/apps/windows-client/node_modules/.bin:$PATH" apps/windows-client/node_modules/.bin/turbo run build typecheck test --filter=@bb/windows-client
```

Read [AGENTS.md](AGENTS.md) for the repository's coding guidelines. Keep changes
focused; document user-facing behavior and verify meaningful failure paths.
Changes to browser transport need real Windows/WSL verification as well as unit
checks. Installer packaging runs on Windows.

Upstream CI and publication workflows are archived in
`.github/upstream-workflows`; only the Windows client workflow is active here.

## Pull requests

Explain the problem, resulting behavior and how you verified it. Use the PR
template and link a related issue when one exists. Do not include build output,
installers, local settings or credentials in commits. Agent-created issues and
PR bodies must end with `> AGENT GENERATED`.

Contributions are distributed under the repository's [MIT license](LICENSE).
Preserve upstream copyright notices when reusing code.
