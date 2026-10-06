import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { testUser } from "./sign-in";

// Reads saved quotes as the app does (DATABASE_URL, under row level security)
const db = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => db.end());

async function fill(page: Page, values: Partial<Record<string, string>> = {}) {
	const all = {
		Address: "1 Main St",
		"Monthly consumption (kWh)": "500",
		"System size (kW)": "10",
		"Down payment (USD, optional)": "",
		...values,
	};
	for (const [label, value] of Object.entries(all)) await page.getByLabel(label).fill(value ?? "");
}

const submit = (page: Page) => page.getByRole("button", { name: "Get pre-qualification" }).click();
// Next adds its own empty role=alert announcer, so look inside the form
const alert = (page: Page) => page.getByRole("form", { name: "Quote form" }).getByRole("alert");
const results = (page: Page) => page.getByRole("region", { name: "Quote results" });

// Saves e2e/screenshots/<test name>[ - step].png so results can be checked later
const shot = (page: Page, step?: string) => {
	const name = [test.info().title, step]
		.filter(Boolean)
		.join(" - ")
		.replace(/[\\/:*?"<>|]/g, "");
	return page.screenshot({
		path: path.join(test.info().project.testDir, "screenshots", `${name}.png`),
		fullPage: true,
	});
};

test.beforeEach(async ({ page }) => {
	await page.goto("/");
});

// Runs after the checks, so it shows the state that was checked (or the state at failure)
test.afterEach(async ({ page }) => {
	await shot(page);
});

test("signed in home page shows the quote form, not the sign in link", async ({ page }) => {
	await expect(page.getByRole("form", { name: "Quote form" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Get personal quote" })).toHaveCount(0);
});

test("submitted quote shows in My quotes from the nav bar, newest first", async ({ page }) => {
	const address = `${crypto.randomUUID()} Listed St`;

	await fill(page, { Address: address, "Down payment (USD, optional)": "1,000" });
	await submit(page);
	await expect(results(page)).toContainText("$12,000.00");

	await page.getByRole("link", { name: "My quotes" }).click();
	await page.waitForURL("/quotes");
	const row = page.getByRole("row", { name: address });
	await expect(row).toContainText("$12,000.00");
	await expect(row).toContainText("$1,000.00");
	await expect(row).toContainText("$217.29"); // 5 years on 11,000 at band A
	await expect(page.getByRole("columnheader", { name: "Owner" })).toHaveCount(0);
	// The test user is not an admin
	await expect(page.getByRole("link", { name: "All quotes" })).toHaveCount(0);
});

// Each browser sees the time in its own zone. Tokyo is UTC+9, so it never matches the UTC text.
for (const timezoneId of ["Asia/Tokyo", "America/New_York"])
	test.describe(`in ${timezoneId}`, () => {
		test.use({ timezoneId });

		test(`My quotes shows the date in the viewer's time zone (${timezoneId})`, async ({ page }) => {
			const address = `${crypto.randomUUID()} Time Zone St`;
			const response = await page.request.post("/api/quotes", {
				data: { requestId: crypto.randomUUID(), address, monthlyConsumptionKwh: 500, systemSizeKw: 10 },
			});
			expect(response.ok()).toBe(true);

			// The server does not know the zone, so its HTML must hold no time text: the browser fills it in.
			// Otherwise the server and browser text differ, and a production build hides that mismatch.
			const html = await (await page.request.get("/quotes")).text();
			expect(html).toMatch(/<time dateTime="[^"]+"><\/time>/);
			expect(html).not.toMatch(/<time dateTime="[^"]+">[^<]/);

			await page.goto("/quotes");
			const time = page.getByRole("row", { name: address }).locator("time");
			const at = new Date((await time.getAttribute("datetime"))!);
			const inZone = (timeZone: string) =>
				new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(at);

			await expect(time).toHaveText(inZone(timezoneId));
			if (timezoneId === "Asia/Tokyo") expect(inZone(timezoneId)).not.toBe(inZone("UTC"));
		});
	});

test("My quotes shows 10 quotes per page, First, Previous, Next and Last move between pages", async ({ page }) => {
	// Quotes are never deleted, so add only what is missing for a second page
	const saved = await savedQuoteCount();
	for (let i = saved; i <= 10; i++) {
		const response = await page.request.post("/api/quotes", {
			data: {
				requestId: crypto.randomUUID(),
				address: `Page Fill ${i} St`,
				monthlyConsumptionKwh: 500,
				systemSizeKw: 10,
			},
		});
		expect(response.ok()).toBe(true);
	}

	await page.goto("/quotes");
	await expect(page.locator("tbody tr")).toHaveCount(10);
	await expect(page.getByText(/^Page 1 of \d+/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

	await page.getByRole("link", { name: "Next" }).click();
	await page.waitForURL("/quotes?page=2");
	await expect(page.getByText(/^Page 2 of \d+/)).toBeVisible();
	await expect(page.locator("tbody tr").first()).toBeVisible();

	await page.getByRole("link", { name: "Previous" }).click();
	await page.waitForURL("/quotes?page=1");
	await expect(page.getByText(/^Page 1 of \d+/)).toBeVisible();
	await expect(page.getByRole("button", { name: "First" })).toBeDisabled();

	// Last goes to the last page the table knew about. Other tests may add quotes meanwhile, so only check it got there.
	const pages = Number((await page.getByText(/^Page 1 of \d+/).textContent())!.match(/of (\d+)/)![1]);
	await page.getByRole("link", { name: "Last" }).click();
	await page.waitForURL(`/quotes?page=${pages}`);
	await expect(page.getByText(new RegExp(`^Page ${pages} of`))).toBeVisible();

	await page.getByRole("link", { name: "First" }).click();
	await page.waitForURL("/quotes?page=1");
	await expect(page.getByText(/^Page 1 of \d+/)).toBeVisible();

	// Past the last page there is nothing to show
	expect((await page.goto("/quotes?page=999999"))?.status()).toBe(404);
});

test("name and email are filled from the signed-in user and cannot be changed", async ({ page }) => {
	await expect(page.getByLabel("Full name")).toHaveValue(testUser.name);
	await expect(page.getByLabel("Email")).toHaveValue(testUser.email);
	await expect(page.getByLabel("Full name")).toBeDisabled();
	await expect(page.getByLabel("Email")).toBeDisabled();
});

test("quote request does not send name or email, the server takes them from the session", async ({ page }) => {
	const request = page.waitForRequest("/api/quotes");

	await fill(page);
	await submit(page);

	const body = (await request).postDataJSON();
	expect(body).not.toHaveProperty("fullName");
	expect(body).not.toHaveProperty("email");
	await expect(results(page)).toContainText("$12,000.00");
});

test("submitted quote is saved with its offers, owned by the signed-in user", async ({ page }) => {
	// Other tests here save quotes in parallel, so find this one by its address
	const address = `${crypto.randomUUID()} Saved St`;

	await fill(page, {
		Address: address,
		"Monthly consumption (kWh)": "512.25",
		"Down payment (USD, optional)": "1,234.56",
	});
	await submit(page);
	await expect(results(page)).toContainText("$12,000.00");

	const client = await db.connect();
	try {
		await client.query("BEGIN");
		await client.query(`SELECT set_config('app.user_id', id, true) FROM "user" WHERE email = $1`, [testUser.email]);
		const { rows } = await client.query(
			`SELECT u.email, q.monthly_consumption_kwh, q.down_payment, q.system_price, q.principal, q.band,
			        array_agg(o.term_years || ':' || o.monthly_payment ORDER BY o.term_years) AS offers
			 FROM quote q JOIN "user" u ON u.id = q.user_id JOIN quote_offer o ON o.quote_id = q.id
			 WHERE q.address = $1 GROUP BY q.id, u.email`,
			[address],
		);
		expect(rows).toEqual([
			{
				email: testUser.email,
				monthly_consumption_kwh: "512.25",
				down_payment: "1234.56",
				system_price: "12000.00",
				principal: "10765.44",
				band: 0, // A, see BAND_CODE in data/quote-store.ts
				offers: ["5:212.66", "10:124.44", "15:96.16"],
			},
		]);
	} finally {
		await client.query("ROLLBACK");
		client.release();
	}
});

// Counts all of this user's saved quotes
async function savedQuoteCount() {
	const client = await db.connect();
	try {
		await client.query("BEGIN");
		await client.query(`SELECT set_config('app.user_id', id, true) FROM "user" WHERE email = $1`, [testUser.email]);
		const { rows } = await client.query(`SELECT count(*)::integer AS n FROM quote WHERE user_id = app_user_id()`);
		return rows[0].n as number;
	} finally {
		await client.query("ROLLBACK");
		client.release();
	}
}

// Counts this user's saved quotes with this address, and reads their request ids
async function savedRequestIds(address: string) {
	const client = await db.connect();
	try {
		await client.query("BEGIN");
		await client.query(`SELECT set_config('app.user_id', id, true) FROM "user" WHERE email = $1`, [testUser.email]);
		const { rows } = await client.query(`SELECT request_id FROM quote WHERE address = $1`, [address]);
		return rows.map((r) => r.request_id);
	} finally {
		await client.query("ROLLBACK");
		client.release();
	}
}

test("resubmit after a lost answer sends the same request id and saves the quote once", async ({ page }) => {
	const address = `${crypto.randomUUID()} Lost Answer St`;
	const sent: string[] = [];
	// The first try reaches the server and is saved, but its answer never reaches the page
	let lose = true;
	await page.route("/api/quotes", async (route) => {
		sent.push(route.request().postDataJSON().requestId);
		if (!lose) return route.continue();
		lose = false;
		await route.fetch();
		await route.abort();
	});

	await fill(page, { Address: address });
	await submit(page);
	await expect(alert(page)).toHaveText("Could not reach the server. Please try again.");

	await submit(page);
	await expect(results(page)).toContainText("$12,000.00");

	expect(sent).toHaveLength(2);
	expect(sent[1]).toBe(sent[0]);
	expect(await savedRequestIds(address)).toEqual([sent[0]]);
});

test("editing the form sends a new request id, so the edited quote is saved too", async ({ page }) => {
	const address = `${crypto.randomUUID()} Edited St`;
	const sent: string[] = [];
	await page.route("/api/quotes", (route) => (sent.push(route.request().postDataJSON().requestId), route.continue()));

	await fill(page, { Address: address });
	await submit(page);
	await expect(results(page)).toContainText("$12,000.00");

	await page.getByLabel("System size (kW)").fill("5");
	await submit(page);
	await expect(results(page)).toContainText("$6,000.00");

	expect(sent).toHaveLength(2);
	expect(sent[1]).not.toBe(sent[0]);
	expect((await savedRequestIds(address)).sort()).toEqual([...sent].sort());
});

test("same inputs after a page reload send a new request id, so a new quote is saved", async ({ page }) => {
	const address = `${crypto.randomUUID()} Reload St`;
	const sent: string[] = [];
	await page.route("/api/quotes", (route) => (sent.push(route.request().postDataJSON().requestId), route.continue()));

	for (let load = 1; load <= 2; load++) {
		await page.goto("/");
		await fill(page, { Address: address });
		await submit(page);
		await expect(results(page)).toContainText("$12,000.00");
	}

	expect(sent).toHaveLength(2);
	expect(sent[1]).not.toBe(sent[0]);
	expect((await savedRequestIds(address)).sort()).toEqual([...sent].sort());
});

test("API retries with one request id, also at the same time, save once", async ({ page }) => {
	const body = {
		requestId: crypto.randomUUID(),
		address: `${crypto.randomUUID()} Retry St`,
		monthlyConsumptionKwh: 500,
		systemSizeKw: 10,
	};
	const post = (data: object) => page.request.post("/api/quotes", { data });

	const first = await post(body);
	const retries = await Promise.all([post(body), post(body), post(body)]);
	expect(first.status()).toBe(200);
	for (const retry of retries) {
		expect(retry.status()).toBe(200);
		expect(await retry.json()).toEqual(await first.json());
	}

	expect(await savedRequestIds(body.address)).toEqual([body.requestId]);
});

test("API refuses an address with a NUL byte instead of answering with a quote it can't save", async ({ page }) => {
	const address = `${crypto.randomUUID()} Nul\u0000 St`;
	const response = await page.request.post("/api/quotes", {
		data: { requestId: crypto.randomUUID(), address, monthlyConsumptionKwh: 500, systemSizeKw: 10 },
	});

	expect(response.status()).toBe(422);
	expect(await response.json()).toEqual({ errors: { address: "Address has a character that is not allowed." } });
});

test("down payment with thousands commas is used, not dropped", async ({ page }) => {
	await fill(page, { "Down payment (USD, optional)": "5,000" });
	await submit(page);

	await expect(results(page)).toContainText("$12,000.00");
	await expect(results(page)).toContainText("Financed amount: $7,000.00");
});

test("blank form shows required errors but no down payment error, and they update while typing", async ({ page }) => {
	await submit(page);

	await expect(page.getByText("Enter your address.")).toBeVisible();
	await expect(page.getByLabel("System size (kW)")).toHaveAttribute("aria-invalid", "true");
	await expect(page.getByLabel("Down payment (USD, optional)")).not.toHaveAttribute("aria-invalid");
	await shot(page, "before typing");

	await page.getByLabel("Address").fill("1 Main St");
	await expect(page.getByText("Enter your address.")).toHaveCount(0);
});

test("bad number text shows an error and sends nothing", async ({ page }) => {
	let requests = 0;
	await page.route("/api/quotes", (route) => (requests++, route.continue()));

	await fill(page, { "Down payment (USD, optional)": "5e3" });
	await submit(page);

	await expect(page.getByText("Enter 0 or more, with at most 2 decimals (cents).")).toBeVisible();
	expect(requests).toBe(0);
});

test("monthly consumption with 3 decimals shows an error and sends nothing", async ({ page }) => {
	let requests = 0;
	await page.route("/api/quotes", (route) => (requests++, route.continue()));

	await fill(page, { "Monthly consumption (kWh)": "500.125" });
	await submit(page);

	await expect(page.getByText("Enter a number above 0 (max 100000), with at most 2 decimals.")).toBeVisible();
	expect(requests).toBe(0);
});

// The server answered, but with nothing the form can use
for (const [body, status, response] of [
	["HTML body", 500, { body: "<html>Internal Server Error</html>" }],
	["JSON body without field errors", 502, { json: { message: "Bad gateway" } }],
	["success body that is not a quote", 200, { json: { offers: [] } }],
] as const) {
	test(`server answer with ${body} (status ${status}) shows a server problem and no offers`, async ({ page }) => {
		await page.route("/api/quotes", (route) => route.fulfill({ status, ...response }));

		await fill(page);
		await submit(page);

		await expect(alert(page)).toHaveText(`The server had a problem (status ${status}). Please try again.`);
		await expect(results(page)).toContainText("Fill in the form to see your offers.");
	});
}

test("request-level error from the server shows in the alert", async ({ page }) => {
	await page.route("/api/quotes", (route) =>
		route.fulfill({ status: 400, json: { errors: { form: "Request body must be valid JSON." } } }),
	);

	await fill(page);
	await submit(page);

	await expect(alert(page)).toHaveText("Request body must be valid JSON.");
});

test("network failure shows a connection message", async ({ page }) => {
	await page.route("/api/quotes", (route) => route.abort());

	await fill(page);
	await submit(page);

	await expect(alert(page)).toHaveText("Could not reach the server. Please try again.");
});

test("editing after a quote marks the offers out of date until resubmit", async ({ page }) => {
	await fill(page);
	await submit(page);
	await expect(results(page)).toContainText("$12,000.00");

	await page.getByLabel("System size (kW)").fill("5");
	await expect(page.getByRole("status")).toContainText("These offers are out of date");
	await shot(page, "out of date");

	await submit(page);
	await expect(results(page)).toContainText("$6,000.00");
	await expect(page.getByRole("status")).toHaveCount(0);
});

// Edits while waiting would make the answer look like it matches the new inputs, so the form is locked until it comes
test("form is locked while a quote is calculated, so the offers always match the inputs", async ({ page }) => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route("/api/quotes", async (route) => {
		await held;
		await route.continue();
	});
	const editable = ["Address", "Monthly consumption (kWh)", "System size (kW)", "Down payment (USD, optional)"];

	await fill(page);
	await submit(page);

	for (const label of editable) await expect(page.getByLabel(label)).toBeDisabled();
	await expect(page.getByRole("button", { name: "Calculating..." })).toBeDisabled();
	await shot(page, "waiting");

	release();
	await expect(results(page)).toContainText("$12,000.00");
	for (const label of editable) await expect(page.getByLabel(label)).toBeEnabled();
	await expect(page.getByRole("status")).toHaveCount(0);
});

test("server field errors show under their field, unknown ones in the alert", async ({ page }) => {
	await page.route("/api/quotes", (route) =>
		route.fulfill({ status: 422, json: { errors: { systemSizeKw: "Size rejected by server.", extra: "Odd field." } } }),
	);

	await fill(page);
	await submit(page);

	await expect(page.getByText("Size rejected by server.")).toBeVisible();
	await expect(page.getByLabel("System size (kW)")).toHaveAttribute("aria-invalid", "true");
	await expect(alert(page)).toHaveText("Odd field.");
});

// Every object has "constructor" and "toString", so these names must not be taken for form fields
test("server errors for names every object has, and several unknown ones, all show in the alert", async ({ page }) => {
	await page.route("/api/quotes", (route) =>
		route.fulfill({ status: 422, json: { errors: { constructor: "First problem.", toString: "Second problem." } } }),
	);

	await fill(page);
	await submit(page);

	await expect(alert(page)).toContainText("First problem.");
	await expect(alert(page)).toContainText("Second problem.");
});
