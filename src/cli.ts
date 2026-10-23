// Operator commands: `node dist/src/cli.js enqueue <kind> <url>` and `notify <text>`.
import { pool } from "./db.js";
import { enqueue } from "./queue.js";
import { sendMessage } from "./telegram.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "enqueue" && args.length === 2) await enqueue(args[0], args[1]);
  else if (command === "notify" && args.length) await sendMessage(args.join(" "));
  else throw new Error("usage: enqueue <kind> <url> | notify <text>");
  console.log("ok");
} finally {
  await pool.end();
}
