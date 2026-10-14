import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat } from "node:fs/promises";
import { parseFileLink } from "./links.ts";

const run = promisify(execFile);
export function powershellScript(path: string, action: "copy" | "reveal" | "resolve") {
  const encoded = Buffer.from(path, "utf8").toString("base64");
  const operation = action === "copy" ? "Set-Clipboard -Value $path" : action === "reveal" ? `Start-Process -FilePath explorer.exe -ArgumentList ('/select,"' + $path + '"')` : "";
  return `$ErrorActionPreference = 'Stop'; $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); if (-not (Test-Path -LiteralPath $path)) { throw 'File does not exist on this PC' }; ${operation}; Write-Output 'ok'`;
}
export async function windowsAction(input: { path: string; action: "copy" | "reveal" | "resolve" }) {
  const path = parseFileLink(input.path);
  if (!path) throw new Error("Некорректный локальный путь.");
  let windowsPath = path;
  let executable = "powershell.exe";
  let prefix: string[] = [];
  const env = { ...process.env };
  if (process.platform !== "win32") {
    if (process.platform !== "linux") throw new Error("Выберите Windows-машину или её WSL для файловых действий.");
    await stat("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
    if (path.startsWith("/")) windowsPath = (await run("wslpath", ["-w", path], { timeout: 10000, maxBuffer: 16384 })).stdout.trim();
    if (!env.WSL_INTEROP) {
      const sockets = (await readdir("/run/WSL")).filter(name => /^\d+_interop$/u.test(name));
      if (!sockets.length) throw new Error("WSL Windows interoperability is unavailable.");
      env.WSL_INTEROP = `/run/WSL/${sockets.sort((a, b) => parseInt(a) - parseInt(b))[0]}`;
    }
    executable = "/init";
    prefix = ["/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"];
  }
  if (!parseFileLink(windowsPath) || windowsPath.startsWith("/") || windowsPath.includes('"')) throw new Error("Не удалось получить безопасный Windows-путь.");
  const script = Buffer.from(powershellScript(windowsPath, input.action), "utf16le").toString("base64");
  await run(executable, [...prefix, "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", script], { env, windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  return { windowsPath };
}
