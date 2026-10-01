import { z } from "zod";
import { connectBaseUrlSchema } from "./config.js";

export const connectActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), baseUrl: connectBaseUrlSchema }).strict(),
  z.object({ action: z.literal("sign-in"), baseUrl: connectBaseUrlSchema }).strict(),
  z.object({ action: z.literal("pair"), baseUrl: connectBaseUrlSchema, code: z.string().trim().min(1).max(8192) }).strict(),
  z.object({ action: z.literal("logout"), baseUrl: connectBaseUrlSchema }).strict(),
  z.object({ action: z.literal("bootstrap") }).strict(),
  z.object({ action: z.literal("status") }).strict(),
]);
export type ConnectAction = z.infer<typeof connectActionSchema>;
