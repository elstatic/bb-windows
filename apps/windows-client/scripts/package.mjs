import { build, Platform, Arch } from "electron-builder";
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const staging = resolve(root, "dist/app");
await mkdir(staging, { recursive: true });
for (const name of ["wsl-browser-helper.cjs", "main.cjs", "preload.cjs", "browser-page-preload.cjs", "find-bar-preload.cjs", "settings-preload.cjs", "settings.html", "icon.png", "LICENSE", "THIRD-PARTY-NOTICES.txt", "client-sdk.cjs", "cli.cjs"]) {
  await copyFile(resolve(root, "dist", name), resolve(staging, name));
}
await writeFile(resolve(staging, "package.json"), JSON.stringify({
  name: "bb-windows-client", productName: "BB Windows", version: manifest.version,
  main: "main.cjs", description: manifest.description, license: "MIT", author: "BB Windows contributors",
}, null, 2));
await build({
  projectDir: root,
  publish: "never",
  targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
  config: {
    appId: "dev.bb.windows-client", productName: "BB Windows",
    directories: { app: staging, output: resolve(root, "release") },
    files: ["**/*"], asar: true, npmRebuild: false,
    electronVersion: "44.3.0", publish: { provider: "github", owner: "elstatic", repo: "bb-windows" },
    artifactName: "BB-Windows-${version}-${arch}-Setup.${ext}",
    win: { target: [{ target: "nsis", arch: ["x64"] }], icon: resolve(root, "dist/icon.png"), signExecutable: false },
    nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "BB Windows", deleteAppDataOnUninstall: false },
  },
});
