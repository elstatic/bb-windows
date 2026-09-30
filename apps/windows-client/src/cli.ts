import { readFile } from "node:fs/promises";
import { readConnection, saveConnection } from "./config.js";

async function run() {
  const [command, ...args] = process.argv.slice(2);
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
