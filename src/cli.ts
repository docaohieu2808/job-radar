// Operator commands: `node dist/src/cli.js enqueue <kind> <url>` and `rescore`.
import { pool } from "./db.js";
import { enqueue } from "./queue.js";
import { rescoreAll } from "./store.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "enqueue" && args.length === 2) await enqueue(args[0], args[1]);
  else if (command === "rescore") console.log(`rescored ${await rescoreAll()}`);
  else throw new Error("usage: enqueue <kind> <url> | rescore");
  console.log("ok");
} finally {
  await pool.end();
}
