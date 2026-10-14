import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_BYTES = 20 * 1024 * 1024;
export const prepareInput = z.object({ path: z.string().min(1).max(8192), threadId: z.string().regex(/^thr_[a-zA-Z0-9]+$/), clientHostId: z.string().min(1) }).strict();
export const resultSchema = z.object({ path: z.string(), source: z.enum(["original", "synced", "downloaded"]) }).strict();
export const actionInput = prepareInput.extend({ action: z.enum(["copy", "reveal", "resolve"]) }).strict();
export const actionResult = z.object({ windowsPath: z.string() }).strict();
export const rpcContract = defineRpcContract({ prepare: { input: prepareInput, output: resultSchema }, action: { input: actionInput, output: actionResult }, client: { input: z.null(), output: z.object({ hostId: z.string().nullable() }) } });
export const hostContract = defineRpcContract({ action: { input: z.object({ path: z.string().min(1).max(8192), action: z.enum(["copy", "reveal", "resolve"]) }).strict(), output: actionResult }, materialize: {
  input: z.object({ sourceHostId: z.string(), sourcePath: z.string(), content: z.string().max(MAX_BYTES * 4 / 3 + 8), sha256: z.string().regex(/^[a-f0-9]{64}$/), candidatePath: z.string().nullable() }).strict(),
  output: resultSchema,
} });
