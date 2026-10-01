import { z } from "zod";
import { connectActionSchema } from "./connect-contract.js";

export const updateActionSchema = z.object({ action: z.enum(["update-status", "update-check", "update-install"]) }).strict();
export const clientActionSchema = z.union([connectActionSchema, updateActionSchema]);
export type ClientAction = z.infer<typeof clientActionSchema>;
