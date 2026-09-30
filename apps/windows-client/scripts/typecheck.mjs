import { readdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const paths = {};
for (const entry of await readdir(resolve(repo, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = resolve(repo, "packages", entry.name);
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")); } catch { continue; }
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const source = typeof value === "string" ? value : value.source ?? value.types ?? value.default;
    if (typeof source === "string") paths[pkg.name + (key === "." ? "" : key.slice(1))] = [resolve(directory, source)];
  }
}
paths["*"] = [resolve(root, "node_modules/*")];
paths["hono/*"] = [resolve(root, "node_modules/hono/dist/types/*")];
paths["ws"] = [resolve(root, "node_modules/@types/ws/index.d.ts")];
const config = resolve(root, ".typecheck.json");
await writeFile(config, JSON.stringify({
  compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true, skipLibCheck: true, esModuleInterop: true, types: ["node"], typeRoots: [resolve(root, "node_modules/@types")], paths },
  include: ["src/**/*.ts", "test/**/*.ts", "../desktop/src/preload.ts", "../desktop/src/browser-page-preload.ts"],
}));
try {
  const child = spawn(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc6"), "-p", config], { stdio: "inherit" });
  process.exitCode = await new Promise(resolve => child.once("exit", resolve));
} finally { await rm(config, { force: true }); }
