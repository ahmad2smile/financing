import { db } from "@/data/db";

const noStore = { "Cache-Control": "no-store" };

// Healthy only when the app can open a database connection and run a query. Every new connection also runs
// the role check in data/db.ts, so a role that skips row level security answers 503 too. Public, no sign in.
export async function GET() {
	try {
		await db.query("SELECT 1");
	} catch (error) {
		console.error("GET /api/health: database is not reachable", error);
		return Response.json({ status: "error" }, { status: 503, headers: noStore });
	}

	return Response.json({ status: "ok" }, { headers: noStore });
}
