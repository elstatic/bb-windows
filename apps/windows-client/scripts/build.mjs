import { build } from "esbuild";
import { readFile, readdir, mkdir, rm, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const desktop = resolve(repo, "apps/desktop");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const aliases = new Map();
for (const entry of await readdir(resolve(repo, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = resolve(repo, "packages", entry.name);
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")); }
  catch { continue; }
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const source = typeof value === "string" ? value : value.source ?? value.default;
    if (typeof source === "string") aliases.set(pkg.name + (key === "." ? "" : key.slice(1)), resolve(directory, source));
  }
}
const workspaceSources = {
  name: "workspace-sources",
  setup(builder) {
    builder.onResolve({ filter: /^@bb\// }, args => {
      const path = aliases.get(args.path);
      if (!path) throw new Error(`Missing workspace source: ${args.path}`);
      return { path };
    });
  },
};
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist"), { recursive: true });
const options = {
  bundle: true, format: "cjs", platform: "node", target: "node24",
  external: ["electron"], plugins: [workspaceSources],
  tsconfigRaw: { compilerOptions: { target: "ES2022", useDefineForClassFields: true } },
  nodePaths: [resolve(root, "node_modules")],
  define: { "process.env.BB_DESKTOP_VERSION": JSON.stringify(manifest.version) },
  metafile: true,
};
for (const [input, output] of [
  [resolve(root, "src/main.ts"), "main.cjs"],
  [resolve(root, "src/connect-service.ts"), "connect-service.cjs"],
  [resolve(root, "src/wsl-browser-helper.ts"), "wsl-browser-helper.cjs"],
  [resolve(desktop, "src/preload.ts"), "preload.cjs"],
  [resolve(desktop, "src/browser-page-preload.ts"), "browser-page-preload.cjs"],
  [resolve(desktop, "src/find-bar-preload.ts"), "find-bar-preload.cjs"],
  [resolve(root, "src/settings-preload.ts"), "settings-preload.cjs"],
  [resolve(root, "src/client-sdk.ts"), "client-sdk.cjs"],
  [resolve(root, "src/cli.ts"), "cli.cjs"],
]) {
  const result = await build({ ...options, entryPoints: [input], outfile: resolve(root, "dist", output) });
  const forbidden = Object.keys(result.metafile.inputs).filter(path => /(?:bb-app|better-sqlite3|node-pty|host-daemon\/src|server\/src)/.test(path));
  if (forbidden.length) throw new Error(`Client contains server dependencies: ${forbidden.join(", ")}`);
}
const settingsHtml = await readFile(resolve(root, "src/settings.html"), "utf8");
const settingsScript = settingsHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
const scriptHash = createHash("sha256").update(settingsScript).digest("base64");
const { writeFile } = await import("node:fs/promises");
await writeFile(resolve(root, "dist/settings.html"), settingsHtml.replace("PLACEHOLDER", scriptHash));
await copyFile(resolve(desktop, "assets/icon.png"), resolve(root, "dist/icon.png"));
await copyFile(resolve(repo, "LICENSE"), resolve(root, "dist/LICENSE"));
const notices = [];
for (const name of ["zod", "hono", "ws", "electron-updater"]) {
  notices.push(name + "\n" + await readFile(resolve(root, "node_modules", name, "LICENSE"), "utf8"));
}
await writeFile(resolve(root, "dist/THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
console.log("Built Windows client without the BB server or host runtime.");
