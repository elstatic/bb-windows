import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_BYTES = 32 * 1024 * 1024;
export const prepareInput = z.object({ path: z.string().min(1).max(8192), threadId: z.string().regex(/^thr_[a-zA-Z0-9]+$/), clientHostId: z.string().min(1) }).strict();
export const resultSchema = z.object({ path: z.string(), source: z.enum(["original", "synced", "downloaded"]) }).strict();
export const rpcContract = defineRpcContract({ prepare: { input: prepareInput, output: resultSchema } });
export const hostContract = defineRpcContract({ materialize: {
  input: z.object({ sourceHostId: z.string(), sourcePath: z.string(), content: z.string().max(MAX_BYTES * 4 / 3 + 8), sha256: z.string().regex(/^[a-f0-9]{64}$/), candidatePath: z.string().nullable() }).strict(),
  output: resultSchema,
} });
