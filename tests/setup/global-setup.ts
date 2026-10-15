import { Pool } from "pg";
import { runMigrations } from "../../src/server/db/migrate";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://kbm:kbm@localhost:5432/kbm_notebook_test";

/** Tạo lại DB kbm_notebook_test sạch và chạy migration (một lần cho cả lượt test). */
export default async function setup() {
  const url = new URL(TEST_DB_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("test")) {
    throw new Error(`Từ chối reset DB không phải DB test: ${dbName}`);
  }
  const adminUrl = new URL(TEST_DB_URL);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_DB_URL);
}
