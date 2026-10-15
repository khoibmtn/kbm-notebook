import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema> & { $client: Pool };

const globalForDb = globalThis as unknown as { __kbmPool?: Pool; __kbmDb?: Db };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL chưa được cấu hình");
  return new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
}

export const pool: Pool = (globalForDb.__kbmPool ??= createPool());
export const db: Db = (globalForDb.__kbmDb ??= drizzle(pool, { schema }) as Db);
export { schema };
export type Database = Db;
