// Runs once when the server starts, before it takes requests
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	// Opening one connection runs the role check in data/db.ts. An unsafe role means refuse to run.
	// An unreachable database only gets logged: the same check still runs on every later connection.
	const { db, UnsafeRoleError } = await import("./data/db");
	try {
		(await db.connect()).release();
	} catch (error) {
		if (error instanceof UnsafeRoleError) {
			console.error(`Refusing to start: ${error.message}`);
			process.exit(1);
		}
		console.error("Startup database role check could not connect, it runs again on every new connection", error);
	}
}
