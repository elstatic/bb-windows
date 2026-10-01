import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { parseFileLink, type FileAction } from "./file-contract.js";

const run = promisify(execFile);
export function createWindowsFileService(args: {
  distribution: () => string | undefined;
  copy: (path: string) => void;
  reveal: (path: string) => void;
  translate?: (path: string, distribution: string | undefined) => Promise<string>;
  exists?: (path: string) => Promise<boolean>;
}) {
  const translate = args.translate ?? (async (path, distribution) => {
    const result = await run("wsl.exe", [...(distribution ? ["--distribution", distribution] : []), "--exec", "wslpath", "-w", path], { windowsHide: true, timeout: 10000, maxBuffer: 16384, encoding: "utf8" });
    return result.stdout.trim();
  });
  const exists = args.exists ?? (async path => { try { const result = await stat(path); return result.isFile() || result.isDirectory(); } catch { return false; } });
  async function resolve(value: string) {
    const sourcePath = parseFileLink(value);
    if (!sourcePath) throw new Error("Некорректный путь к файлу.");
    let windowsPath: string;
    try { windowsPath = sourcePath.startsWith("/") ? await translate(sourcePath, args.distribution()) : sourcePath; }
    catch { throw new Error("Не удалось получить Windows-путь. Проверьте выбранный дистрибутив WSL."); }
    const validated = parseFileLink(windowsPath);
    if (!validated || validated.startsWith("/")) throw new Error("WSL не вернул Windows-путь.");
    if (!await exists(validated)) throw new Error("Файл недоступен на этом компьютере. Если он на другой машине, сначала скачайте его или подключите сетевую папку. Исходный путь можно скопировать отдельно.");
    return { sourcePath, windowsPath: validated };
  }
  return {
    resolve,
    async execute(payload: FileAction) {
      const target = await resolve(payload.path);
      if (payload.action === "file-copy") args.copy(target.windowsPath);
      if (payload.action === "file-reveal") args.reveal(target.windowsPath);
      return target;
    },
  };
}
