export function parseFileLink(value: string): string | null {
  if (!value || /[\u0000-\u001f]/u.test(value)) return null;
  let path = value;
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.username || url.password || url.search) return null;
      path = decodeURIComponent(url.pathname);
      if (url.hostname && url.hostname !== "localhost") {
        if (!["wsl.localhost", "wsl$"].includes(url.hostname.toLowerCase())) return null;
        path = `\\\\${url.hostname}${path.replaceAll("/", "\\")}`;
      } else if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    } catch { return null; }
  } else {
    path = path.replace(/#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$|:\d+(?::\d+|-\d+)?$/u, "");
  }
  if (/[\u0000-\u001f]/u.test(path)) return null;
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    if (path.slice(2).includes(":")) return null;
    return path.replaceAll("/", "\\");
  }
  if (/^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+\\/i.test(path)) return path;
  if (path.startsWith("/") && !path.startsWith("//")) return path;
  return null;
}
