import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

// Starts the built app (playwright.config.ts builds it first) with roles that skip row level security,
// and checks it refuses to run. Needs `docker compose up -d`. Dev-only passwords from docker-compose.yml.
const admin = new Pool({ connectionString: "postgres://superuser:superuser@localhost:5432/financing" });

const bypassRole = "e2e_bypassrls";

test.beforeAll(async () => {
	await admin.query(`DROP ROLE IF EXISTS ${bypassRole}`);
	await admin.query(`CREATE ROLE ${bypassRole} WITH LOGIN PASSWORD '${bypassRole}' NOSUPERUSER BYPASSRLS`);
});
test.afterAll(async () => {
	await admin.query(`DROP ROLE IF EXISTS ${bypassRole}`);
	await admin.end();
});

// Resolves with the exit code and output, or fails if the server is still running after the timeout
function startApp(databaseUrl: string, port: number) {
	return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
		const app = spawn("pnpm", ["start", "--port", String(port)], {
			env: { ...process.env, DATABASE_URL: databaseUrl },
		});
		let output = "";
		app.stdout.on("data", (chunk) => (output += chunk));
		app.stderr.on("data", (chunk) => (output += chunk));

		const timer = setTimeout(() => {
			app.kill();
			reject(new Error(`App still running after 20s:\n${output}`));
		}, 20_000);
		app.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, output });
		});
	});
}

const cases = [
	{ name: "superuser", url: "postgres://superuser:superuser@localhost:5432/financing", port: 3102 },
	{ name: "bypassrls", url: `postgres://${bypassRole}:${bypassRole}@localhost:5432/financing`, port: 3103 },
];

for (const { name, url, port } of cases) {
	test(`app refuses to start as a ${name} role`, async () => {
		const { code, output } = await startApp(url, port);

		expect(code).toBe(1);
		expect(output).toContain(`"msg":"refusing to start"`);
		expect(output).toContain("skips row level security");
	});
}
