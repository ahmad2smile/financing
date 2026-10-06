import { Pool } from "pg";

// One pool per process. Dev hot reload re-runs this module, so keep it on globalThis.
const globalForDb = globalThis as unknown as { db?: Pool };
export const db = (globalForDb.db ??= new Pool({ connectionString: process.env.DATABASE_URL }));
