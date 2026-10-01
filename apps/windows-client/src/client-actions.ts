import { z } from "zod";
import { fileActionSchema } from "./file-contract.js";
import { connectActionSchema } from "./connect-contract.js";

export const updateActionSchema = z.object({ action: z.enum(["update-status", "update-check", "update-install"]) }).strict();
export const clientActionSchema = z.union([connectActionSchema, updateActionSchema, fileActionSchema]);
export type ClientAction = z.infer<typeof clientActionSchema>;
