import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";

/** Chạy migration (dùng cho `pnpm db:migrate` và global setup của vitest). Không import server-only. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && /migrate\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  config({ path: ".env" });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL chưa được cấu hình");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log("Migration hoàn tất");
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
