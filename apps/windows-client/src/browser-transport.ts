import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";

const channel = z.string().uuid();
export const browserFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), hostId: z.string().min(1), serverUrl: z.string().url() }).strict(),
  z.object({ type: z.literal("broker"), value: z.json() }).strict(),
  z.object({ type: z.literal("open"), channel, port: z.number().int().min(1).max(65535) }).strict(),
  z.object({ type: z.literal("data"), channel, data: z.string().max(128 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict(),
  z.object({ type: z.literal("end"), channel }).strict(),
]);
export type BrowserFrame = z.infer<typeof browserFrameSchema>;
export function createBrowserTransport(input: Readable, output: Writable, receive: (frame: BrowserFrame) => void, fail: (error: Error) => void) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", line => {
    try {
      if (line.length > 24 * 1024 * 1024) throw new Error("Browser bridge message is too large");
      receive(browserFrameSchema.parse(JSON.parse(line)));
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
  lines.on("error", fail);
  output.on("error", fail);
  return {
    send(frame: BrowserFrame): boolean { return output.write(JSON.stringify(browserFrameSchema.parse(frame)) + "\n"); },
    drain(callback: () => void) { output.once("drain", callback); },
    close() { lines.close(); },
  };
}
export function windowsPathToWsl(path: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  if (!match) throw new Error("Browser bridge must be installed on a Windows drive");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}
