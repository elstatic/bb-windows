import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.ts";
import { materialize } from "./cache.ts";

export default experimental_defineHostEntry({ contract: hostContract, handlers: {
  materialize: (input, context) => materialize(context.experimental_paths.dataDir, input),
} });
