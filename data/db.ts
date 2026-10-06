import { Pool, type ClientBase } from "pg";

// Superusers and roles with bypassrls skip row level security (docker/postgres/03-quotes.sql) without any error.
export class UnsafeRoleError extends Error {}

// Runs on every new connection before the pool hands it out, so no query ever runs as an unsafe role,
// even if the role is changed while the app runs. A throw here closes the connection.
async function refuseUnsafeRole(client: ClientBase) {
	const { rows } = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
		"SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
	);
	const role = rows[0];

	if (!role || role.rolsuper || role.rolbypassrls)
		throw new UnsafeRoleError(
			`Database role "${role?.rolname}" skips row level security (superuser or bypassrls). Connect as "financing".`,
		);
}

// One pool per process. Dev hot reload re-runs this module, so keep it on globalThis.
const globalForDb = globalThis as unknown as { db?: Pool };
export const db = (globalForDb.db ??= new Pool({
	connectionString: process.env.DATABASE_URL,
	onConnect: refuseUnsafeRole,
}));
