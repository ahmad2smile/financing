import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { signedInState } from "./e2e/sign-in";

// Tests read DATABASE_URL. The app loads .env by itself.
if (existsSync(".env")) process.loadEnvFile();

const port = 3100;
// Same build, but DATABASE_URL points to a port nothing listens on, so every page and API call throws
const brokenPort = 3101;

export default defineConfig({
	testDir: "e2e",
	use: { baseURL: `http://localhost:${port}` },
	// Needs `docker compose up -d`: sign in goes through Keycloak, sessions live in Postgres
	projects: [
		{ name: "setup", testMatch: "auth.setup.ts" },
		{
			name: "signed-in",
			testMatch: "quote-form.spec.ts",
			use: { storageState: signedInState },
			dependencies: ["setup"],
		},
		{ name: "signed-out", testMatch: "auth.spec.ts" },
		{ name: "database", testMatch: ["quote-storage.spec.ts", "unsafe-role.spec.ts"] },
		{
			name: "server-error",
			testMatch: "server-error.spec.ts",
			use: { baseURL: `http://localhost:${brokenPort}`, storageState: signedInState },
			dependencies: ["setup"],
		},
	],
	// Started one after another, so the second server reuses the first one's build
	webServer: [
		{
			command: `pnpm build && pnpm start --port ${port}`,
			// .env points at the dev port and client. Tests use their own, whose back-channel logout calls this port.
			env: {
				BETTER_AUTH_URL: `http://localhost:${port}`,
				KEYCLOAK_CLIENT_ID: "financing-web-e2e",
				KEYCLOAK_CLIENT_SECRET: "financing-e2e-secret",
			},
			url: `http://localhost:${port}`,
			reuseExistingServer: !process.env.CI,
			timeout: 180_000,
		},
		{
			command: `pnpm start --port ${brokenPort}`,
			env: {
				BETTER_AUTH_URL: `http://localhost:${brokenPort}`,
				DATABASE_URL: "postgres://financing:financing@127.0.0.1:1/financing",
			},
			// Every page fails on this server, so wait on a static file
			url: `http://localhost:${brokenPort}/favicon.ico`,
			reuseExistingServer: !process.env.CI,
		},
	],
});
