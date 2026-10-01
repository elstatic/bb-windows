import { createServer, connect } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { clientActionSchema, type ClientAction } from "./client-actions.js";

const descriptorSchema = z.object({ endpoint: z.string().min(1), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const pipePrefix = String.raw`\\.\pipe\bb-windows-`;
export async function startClientControl(userData: string, run: (request: ClientAction) => Promise<unknown>) {
  const token = randomBytes(32).toString("hex");
  const endpoint = process.platform === "win32" ? pipePrefix + randomBytes(16).toString("hex") : join(userData, `control-${randomBytes(8).toString("hex")}.sock`);
  const path = join(userData, "client-control.json");
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer(socket => {
    if (sockets.size >= 16) { socket.destroy(); return; }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(20000, () => socket.destroy());
    let input = "";
    let handled = false;
    socket.on("data", data => {
      if (handled) { socket.destroy(); return; }
      input += data.toString();
      if (input.length > 16384) { socket.destroy(); return; }
      if (!input.includes("\n")) return;
      handled = true;
      void (async () => {
        try {
          const value = z.object({ token: z.string(), request: clientActionSchema }).strict().parse(JSON.parse(input));
          const actual = Buffer.from(value.token), expected = Buffer.from(token);
          if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Unauthorized client command");
          socket.end(JSON.stringify({ ok: true, result: await run(value.request) }) + "\n");
        } catch { socket.end(JSON.stringify({ ok: false, error: "Client command failed. Check the application and connection settings." }) + "\n"); }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(endpoint, () => { server.off("error", reject); resolve(); }); });
  await writeFile(path, JSON.stringify({ endpoint, token }), { mode: 0o600 });
  return {
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await unlink(path).catch(() => {});
      if (process.platform !== "win32") await unlink(endpoint).catch(() => {});
    },
  };
}
export async function requestClientControl(userData: string, payload: unknown): Promise<unknown> {
  const request = clientActionSchema.parse(payload);
  const descriptor = descriptorSchema.parse(JSON.parse(await readFile(join(userData, "client-control.json"), "utf8")));
  if (process.platform === "win32" ? !descriptor.endpoint.startsWith(pipePrefix) : !descriptor.endpoint.startsWith(join(userData, "control-"))) throw new Error("Invalid client control endpoint");
  return new Promise((resolve, reject) => {
    const socket = connect(descriptor.endpoint);
    let output = "";
    socket.setTimeout(20000, () => socket.destroy(new Error("Client command timed out")));
    socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify({ token: descriptor.token, request }) + "\n"));
    socket.on("data", data => {
      output += data.toString();
      if (output.length > 1024 * 1024) socket.destroy(new Error("Client response is too large"));
    });
    socket.on("end", () => {
      try {
        const response = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), result: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })]).parse(JSON.parse(output));
        if (response.ok) resolve(response.result); else reject(new Error(response.error));
      } catch (error) { reject(error); }
    });
  });
}
