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
		// Gives or takes the realm role "admin" from docker/keycloak/financing-realm.json
		setAdmin: async (id: string, admin: boolean) => {
			const role = await (await request.get(`${users.replace("/users", "/roles")}/admin`, { headers })).json();
			const url = `${users}/${id}/role-mappings/realm`;
			return admin ? request.post(url, { headers, data: [role] }) : request.delete(url, { headers, data: [role] });
		},
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

const appRole = async (userEmail: string) =>
	(await db.query(`SELECT role FROM "user" WHERE email = $1`, [userEmail])).rows[0]?.role;

test("seeded admin signs in as admin, the test user as user", async ({ page }) => {
	await page.goto("/");
	await signInWithKeycloak(page, { email: "admin@test.com", password: "admin" });
	await expect(page.getByText("admin@test.com")).toBeVisible();

	expect(await appRole("admin@test.com")).toBe("admin");
	expect(await appRole(email)).toBe("user");
});

test("admin role is copied from Keycloak on every sign in, given and taken away", async ({
	page,
	request,
	tempUser,
}) => {
	const admin = await keycloakAdmin(request);
	expect((await admin.setAdmin(tempUser.id, true)).ok()).toBe(true);

	await page.goto("/");
	await signInWithKeycloak(page, tempUser);
	await expect(page.getByText(tempUser.email)).toBeVisible();
	expect(await appRole(tempUser.email)).toBe("admin");

	await page.getByRole("button", { name: "Sign out" }).click();
	expect((await admin.setAdmin(tempUser.id, false)).ok()).toBe(true);
	await signInWithKeycloak(page, tempUser);
	await expect(page.getByText(tempUser.email)).toBeVisible();
	expect(await appRole(tempUser.email)).toBe("user");
});

test("signed out home page has no quote form, get personal quote goes to sign in, then to the form", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByRole("form", { name: "Quote form" })).toHaveCount(0);

	await expect(page.getByRole("link", { name: "My quotes" })).toHaveCount(0);

	await page.getByRole("link", { name: "Get personal quote" }).click();
	await loginOnKeycloak(page);

	await page.waitForURL("/");
	await expect(page.getByRole("form", { name: "Quote form" })).toBeVisible();
	await expect(page.getByText(email)).toBeVisible();
});

// A fixed id: the test title must be the same in every worker
for (const path of ["/quotes", "/admin/quotes", "/quotes/0199a1b2-0000-7000-8000-000000000001"]) {
	test(`signed out visit to ${path} never shows quotes and goes to sign in`, async ({ request }) => {
		const response = await request.get(path, { maxRedirects: 0 });

		expect(response.status()).toBe(307);
		expect(response.headers().location).toBe(`/sign-in?${new URLSearchParams({ callbackUrl: path })}`);
		expect(await response.text()).not.toContain("<table");
	});
}

// Saves a quote through the API as the user signed in on this page, and returns its address
async function saveQuoteAs(page: Page, name: string) {
	const address = `${crypto.randomUUID()} ${name} St`;
	const response = await page.request.post("/api/quotes", {
		data: { requestId: crypto.randomUUID(), address, monthlyConsumptionKwh: 500, systemSizeKw: 10 },
	});
	expect(response.ok()).toBe(true);
	return address;
}

// Looks for a row with this text on every page of the table, from page 1, and returns its text or null.
// Other tests save quotes at the same time, so a row can move to a later page.
async function findRow(page: Page, path: string, text: string) {
	await page.goto(path);
	for (let n = 1; ; n++) {
		await expect(page.getByText(new RegExp(`^Page ${n} of`))).toBeVisible();
		const row = page.getByRole("row", { name: text });
		if (await row.count()) return row.textContent();

		// On the last page Next is a disabled button, not a link
		const next = page.getByRole("link", { name: "Next" });
		if (!(await next.count())) return null;
		await next.click();
	}
}

// Not tempUser: it is removed after the test, and saved quotes can never be removed, so its user row could not be.
// Only signs in, never out, so testUser's session shared with the quote form tests stays.
test("My quotes shows only your own quotes, All quotes is only for admins and shows everyone's", async ({
	browser,
	page,
}) => {
	await signInAt(page, "/quotes");
	const userAddress = await saveQuoteAs(page, "User");

	const adminPage = await browser.newPage();
	await signInAt(adminPage, "/quotes", { email: "admin@test.com", password: "admin" });
	const adminAddress = await saveQuoteAs(adminPage, "Admin");

	// User: own quote in My quotes, no link to All quotes, and the page itself is not there
	expect(await findRow(page, "/quotes", userAddress)).not.toBeNull();
	expect(await findRow(page, "/quotes", adminAddress)).toBeNull();
	await expect(page.getByRole("link", { name: "All quotes" })).toHaveCount(0);
	expect((await page.goto("/admin/quotes"))?.status()).toBe(404);

	// Admin: My quotes is still only their own
	expect(await findRow(adminPage, "/quotes", adminAddress)).not.toBeNull();
	expect(await findRow(adminPage, "/quotes", userAddress)).toBeNull();

	// Admin: All quotes has both, with their owners
	await adminPage.getByRole("link", { name: "All quotes" }).click();
	await adminPage.waitForURL("/admin/quotes");
	expect(await findRow(adminPage, "/admin/quotes", userAddress)).toContain(email);
	expect(await findRow(adminPage, "/admin/quotes", adminAddress)).toContain("admin@test.com");
	await adminPage.close();
});

// Every way a quote can't be read gives the same 404, so nobody learns which quote ids exist.
// tempUser saves no quote, so it can be removed after the test.
test("a quote's details are only for its owner and admins, everyone else gets a 404", async ({
	browser,
	page,
	request,
	tempUser,
}) => {
	await signInAt(page, "/quotes");
	const address = await saveQuoteAs(page, "Details");
	expect(await findRow(page, "/quotes", address)).not.toBeNull();
	const href = (await page.getByRole("link", { name: address }).getAttribute("href"))!;
	expect(href).toMatch(/^\/quotes\/[0-9a-f-]{36}$/);

	// Owner: page and API
	expect((await page.goto(href))?.status()).toBe(200);
	await expect(page.getByLabel("Quote inputs")).toContainText(address);
	const own = await page.request.get(`/api${href}`);
	expect(own.status()).toBe(200);
	expect(await own.json()).toMatchObject({ id: href.split("/").pop(), address, ownerEmail: email, band: "A" });

	// Another user: the same 404 as a quote that does not exist, or an id that is not a UUID
	const other = await browser.newPage();
	await signInAt(other, "/quotes", tempUser);
	for (const path of [href, `/quotes/${crypto.randomUUID()}`, "/quotes/not-a-uuid"]) {
		expect((await other.goto(path))?.status()).toBe(404);
		await expect(other.getByText(address)).toHaveCount(0);

		const response = await other.request.get(`/api${path}`);
		expect(response.status()).toBe(404);
		expect(await response.json()).toEqual({ errors: { form: "Quote not found." } });
	}
	await other.close();

	// Admin: from All quotes, with the owner, and back to All quotes
	const adminPage = await browser.newPage();
	await signInAt(adminPage, "/quotes", { email: "admin@test.com", password: "admin" });
	expect(await findRow(adminPage, "/admin/quotes", address)).toContain(email);
	await adminPage.getByRole("link", { name: address }).click();
	await adminPage.waitForURL(href);
	await expect(adminPage.getByLabel("Quote inputs")).toContainText(email);
	await expect(adminPage.getByRole("link", { name: "Back to All quotes" })).toBeVisible();
	expect((await adminPage.request.get(`/api${href}`)).status()).toBe(200);
	await adminPage.close();

	// Signed out: the API refuses before reading
	const signedOut = await request.get(`/api${href}`);
	expect(signedOut.status()).toBe(401);
	expect(await signedOut.json()).toEqual({ errors: { form: "Sign in to see this quote." } });
});

test("a page number that is not a number is a 404", async ({ page }) => {
	await signInAt(page, "/quotes");

	for (const bad of ["0", "-1", "abc", "1.5"]) expect((await page.goto(`/quotes?page=${bad}`))?.status()).toBe(404);
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
	await page.goto("/");
	await signInWithKeycloak(page, tempUser);
	await expect(page.getByLabel("Full name")).toHaveValue("Ada Lovelace");

	// Changed in Keycloak: the next sign in brings the new name
	const admin = await keycloakAdmin(request);
	await admin.update(tempUser.id, { firstName: "Ada", lastName: "Byron", email: tempUser.email });
	const next = await browser.newPage();
	await next.goto("/");
	await signInWithKeycloak(next, tempUser);
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
