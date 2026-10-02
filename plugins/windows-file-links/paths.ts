import { posix } from "node:path";

export function contained(root: string, path: string): boolean {
  const relative = posix.relative(posix.resolve(root), posix.resolve(path));
  return relative !== "" && relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative);
}
export function normalizeSource(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\u0000-\u001f]/u.test(path)) throw new Error("Use an absolute Linux file path.");
  return posix.normalize(path);
}
export function mapPath(sourceHostId: string, clientHostId: string, sourcePath: string, mappings: { sourceHostId: string; clientHostId: string; sourceRoot: string; localRoot: string }[]): string | null {
  const mapping = mappings.filter(m => m.sourceHostId === sourceHostId && m.clientHostId === clientHostId && contained(m.sourceRoot, sourcePath)).sort((a, b) => b.sourceRoot.length - a.sourceRoot.length)[0];
  return mapping ? posix.join(mapping.localRoot, posix.relative(mapping.sourceRoot, sourcePath)) : null;
}
