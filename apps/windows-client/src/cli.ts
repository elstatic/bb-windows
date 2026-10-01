import { readFile } from "node:fs/promises";
import { requestClientControl } from "./client-control.js";
import { DEFAULT_CONNECT_BASE_URL } from "./config.js";
import { readConnection, saveConnection } from "./config.js";

async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "update") {
    const dataIndex = args.indexOf("--data-dir");
    if (dataIndex < 0 || !args[dataIndex + 1] || !["status", "check", "install"].includes(args[0])) throw new Error("Usage: node cli.cjs update status|check|install --data-dir <BB Windows app-data directory>");
    console.log(JSON.stringify(await requestClientControl(args[dataIndex + 1], { action: `update-${args[0]}` }), null, 2));
    return;
  }
  if (command === "connect") {
    const action = args[0];
    const dataIndex = args.indexOf("--data-dir");
    if (dataIndex < 0 || !args[dataIndex + 1]) throw new Error("connect requires --data-dir <BB Windows app-data directory>");
    const baseIndex = args.indexOf("--base-url");
    const baseUrl = baseIndex < 0 ? DEFAULT_CONNECT_BASE_URL : args[baseIndex + 1];
    let payload: unknown = ["status", "bootstrap"].includes(action) ? { action } : { action, baseUrl };
    if (action === "pair") {
      const inputIndex = args.indexOf("--input");
      if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error("pair requires --input <private code file>");
      payload = { action, baseUrl, code: (await readFile(args[inputIndex + 1], "utf8")).trim() };
    }
    console.log(JSON.stringify(await requestClientControl(args[dataIndex + 1], payload), null, 2));
    return;
  }
  const file = args[args.indexOf("--file") + 1];
  if (!args.includes("--file") || !file || !["show", "set"].includes(command)) throw new Error("Usage: node cli.cjs show --file <connection.json> | set --file <connection.json> --input <json-file>");
  if (command === "show") console.log(JSON.stringify(await readConnection(file), null, 2));
  else {
    const input = args[args.indexOf("--input") + 1];
    if (!args.includes("--input") || !input) throw new Error("set requires --input <json-file>");
    console.log(JSON.stringify(await saveConnection(file, JSON.parse(await readFile(input, "utf8"))), null, 2));
  }
}
void run().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
