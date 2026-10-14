import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.ts";
import { windowsAction } from "./windows.ts";
import { materialize } from "./cache.ts";

export default experimental_defineHostEntry({ contract: hostContract, handlers: {
  action: windowsAction,
  materialize: (input, context) => materialize(context.experimental_paths.dataDir, input),
} });
