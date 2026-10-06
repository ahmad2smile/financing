import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import { loginOnKeycloak, signInAt, signInWithKeycloak, testUser } from "./sign-in";

// Needs `docker compose up -d` (Keycloak + Postgres) and a .env copied from .env.example
const db = new Pool({ connectionString: process.env.DATABASE_URL });
base.afterAll(() => db.end());

const { email } = testUser;

// Keycloak admin API with the dev-only admin from docker-compose.yml
async function keycloakAdmin(request: APIRequestContext) {
	const token = await request.post("http://localhost:8080/realms/master/protocol/openid-connect/token", {
		form: { client_id: "admin-cli", username: "admin", password: "admin", grant_type: "password" },
	});
	const headers = { Authorization: `Bearer ${(await token.json()).access_token}` };
	const users = "http://localhost:8080/admin/realms/financing/users";

	return {
		create: (user: object) => request.post(users, { headers, data: { enabled: true, emailVerified: true, ...user } }),
		find: async (email: string) =>
			(await (await request.get(users, { headers, params: { email, exact: true } })).json())[0],
		update: (id: string, user: object) => request.put(`${users}/${id}`, { headers, data: user }),
		remove: (id: string) => request.delete(`${users}/${id}`, { headers }),
		// Ends all the user's Keycloak sessions, like "Sign out" in the admin console
		signOut: (id: string) => request.post(`${users}/${id}/logout`, { headers }),
	};
}

// A fresh Keycloak user per test, removed after it from Keycloak and the app.
// Use it to sign out or end sessions: that ends every app session of the user, and testUser's
// saved session is shared with the quote form tests running in parallel.
const test = base.extend<{ tempUser: { id: string; email: string; password: string } }>({
	// Not named "use": the React hooks lint rule would take it for React's use()
	tempUser: async ({ request }, provide, testInfo) => {
		const admin = await keycloakAdmin(request);
		const user = { email: `temp-${testInfo.workerIndex}-${Date.now()}@test.com`, password: "temp" };
		const created = await admin.create({
			username: user.email,
			email: user.email,
			firstName: "Ada",
			lastName: "Lovelace",
			credentials: [{ type: "password", value: user.password, temporary: false }],
		});
		expect(created.status()).toBe(201);
		const { id } = await admin.find(user.email);

		await provide({ id, ...user });

		await admin.remove(id);
		await db.query(`DELETE FROM "user" WHERE email = $1`, [user.email]);
	},
});

// All app sessions of a user
const appSessions = async (userEmail: string) =>
	(await db.query(`SELECT 1 FROM session s JOIN "user" u ON u.id = s."userId" WHERE u.email = $1`, [userEmail]))
		.rowCount;

// Looks up this browser's own session
async function sessionRow(page: Page) {
	const cookie = (await page.context().cookies()).find((c) => c.name.endsWith("session_token"));
	if (!cookie) return undefined;

	// The cookie holds "<token>.<signature>", the table only the token
	const token = decodeURIComponent(cookie.value).split(".")[0];
	const { rows } = await db.query(
		`SELECT u.email FROM session s JOIN "user" u ON u.id = s."userId" WHERE s.token = $1 AND s."expiresAt" > now()`,
		[token],
	);
	return { token, email: rows[0]?.email as string | undefined };
}

test("sign in through Keycloak saves the session in Postgres, sign out ends it", async ({ page, tempUser }) => {
	await page.goto("/");
	expect(await sessionRow(page)).toBeUndefined();

	await signInWithKeycloak(page, tempUser);

	await expect(page.getByText(tempUser.email)).toBeVisible();
	const signedIn = await sessionRow(page);
	expect(signedIn?.email).toBe(tempUser.email);

	await page.getByRole("button", { name: "Sign out" }).click();

	await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
	expect(await sessionRow(page)).toBeUndefined();
	const { rowCount } = await db.query(`SELECT 1 FROM session WHERE token = $1`, [signedIn!.token]);
	expect(rowCount).toBe(0);

	// Keycloak session must be gone too, so signing in asks for the password again
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.locator("#password")).toBeVisible();
});

test("signed out home page has no quote form, get personal quote goes to sign in, then to the form", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByRole("form", { name: "Quote form" })).toHaveCount(0);

	await page.getByRole("link", { name: "Get personal quote" }).click();
	await loginOnKeycloak(page);

	await page.waitForURL("/quotes");
	await expect(page.getByRole("form", { name: "Quote form" })).toBeVisible();
	await expect(page.getByText(email)).toBeVisible();
});

test("signed out visit to /quotes never shows the form and goes to sign in", async ({ request }) => {
	const response = await request.get("/quotes", { maxRedirects: 0 });

	expect(response.status()).toBe(307);
	expect(response.headers().location).toBe("/sign-in?callbackUrl=%2Fquotes");
	expect(await response.text()).not.toContain("Quote form");
});

// Browsers read "/\host" and "/<tab>/host" as "//host", so these must be refused like a full URL
for (const callbackUrl of ["https://evil.example.com/", "/%5Cevil.example.com", "/%09/evil.example.com"]) {
	test(`sign in with outside callbackUrl ${callbackUrl} lands on the app, not the outside site`, async ({ page }) => {
		await page.goto(`/sign-in?callbackUrl=${callbackUrl}`);

		await loginOnKeycloak(page);

		await page.waitForURL("/");
		await expect(page.getByText(email)).toBeVisible();
	});
}

test("signed out quote request is still refused by the API", async ({ request }) => {
	const response = await request.post("/api/quotes", {
		data: {
			fullName: "Jane Doe",
			email: "jane@test.com",
			address: "1 Main St",
			monthlyConsumptionKwh: 500,
			systemSizeKw: 10,
		},
	});

	expect(response.status()).toBe(401);
});

test("Keycloak refuses a user without a first or last name, even from an admin", async ({ request }) => {
	const admin = await keycloakAdmin(request);
	const users = [
		{ username: "no-last@test.com", email: "no-last@test.com", firstName: "No" },
		{ username: "no-first@test.com", email: "no-first@test.com", lastName: "No" },
	];

	for (const user of users) {
		const created = await admin.create(user);

		// Removed before the check, so a realm that wrongly accepts it can't leave it behind for the next run
		const leftover = await admin.find(user.email);
		if (leftover) await admin.remove(leftover.id);

		expect(created.status()).toBe(400);
	}
});

test("full name on the quote form is first and last name from Keycloak, and follows changes there", async ({
	page,
	browser,
	request,
	tempUser,
}) => {
	await signInAt(page, "/quotes", tempUser);
	await expect(page.getByLabel("Full name")).toHaveValue("Ada Lovelace");

	// Changed in Keycloak: the next sign in brings the new name
	const admin = await keycloakAdmin(request);
	await admin.update(tempUser.id, { firstName: "Ada", lastName: "Byron", email: tempUser.email });
	const next = await browser.newPage();
	await signInAt(next, "/quotes", tempUser);
	await expect(next.getByLabel("Full name")).toHaveValue("Ada Byron");
	await next.close();
});

test("ending a user's sessions in Keycloak signs them out of the app on every device", async ({
	page,
	browser,
	request,
	tempUser,
}) => {
	const otherDevice = await browser.newPage();
	for (const p of [page, otherDevice]) await signInAt(p, "/quotes", tempUser);
	expect(await appSessions(tempUser.email)).toBe(2);

	const admin = await keycloakAdmin(request);
	expect((await admin.signOut(tempUser.id)).status()).toBe(204);

	// Keycloak calls /api/backchannel-logout before it answers, but don't depend on that
	await expect.poll(() => appSessions(tempUser.email)).toBe(0);
	for (const p of [page, otherDevice]) {
		await p.goto("/");
		await expect(p.getByRole("button", { name: "Sign in" })).toBeVisible();
	}
	await otherDevice.close();
});

test("back-channel logout refuses a missing or forged token", async ({ request }) => {
	const missing = await request.post("/api/backchannel-logout", { form: {} });
	const forged = await request.post("/api/backchannel-logout", { form: { logout_token: "e30.e30.forged" } });

	expect(missing.status()).toBe(400);
	expect(forged.status()).toBe(400);
	expect(await forged.json()).toEqual({ error: "invalid_request" });
});
