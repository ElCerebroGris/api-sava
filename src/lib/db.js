import { Pool, types } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required; configure the Neon connection URL in .env");
}
types.setTypeParser(20, value => Number(value)); // BIGINT/count results remain JSON-safe.
types.setTypeParser(1700, value => Number(value)); // NUMERIC ratings/rates.

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
const transactionContext = new AsyncLocalStorage();

function postgresSql(sql) {
  sql = sql.replace(/\?\s*=\s*""/g, "? = ''");
  return sql.replace(/\?(?=(?:[^']*'[^']*')*[^']*$)/g, (_, offset) => {
    // Positional parameters only occur outside SQL string literals.
    const preceding = sql.slice(0, offset);
    return `$${(preceding.match(/\?/g) || []).length + 1}`;
  });
}

async function query(sql, params = []) {
  const client = transactionContext.getStore() || pool;
  const statement = postgresSql(sql);
  return params.length ? client.query(statement, params) : client.query(statement);
}

export const db = {
  query,
  prepare(sql) {
    return {
      async get(...params) { return (await query(sql, params)).rows[0]; },
      async all(...params) { return (await query(sql, params)).rows; },
      async run(...params) {
        const result = await query(sql, params);
        return { changes: result.rowCount, rows: result.rows };
      },
    };
  },
  async exec(sql) { return query(sql); },
  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await transactionContext.run(client, () => fn(...args));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
  },
  async close() { await pool.end(); },
};

export { pool };
