import "dotenv/config";
import fs from "node:fs/promises";
import { db } from "./lib/db.js";

try {
  const schema = await fs.readFile(new URL("../migrations/001_init.sql", import.meta.url), "utf8");
  await db.exec(schema);
  console.log("Neon PostgreSQL schema is up to date");
} finally {
  await db.close();
}
