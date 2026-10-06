import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { testUser } from "./sign-in";

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
	await page.goto("/quotes");
});

// Runs after the checks, so it shows the state that was checked (or the state at failure)
test.afterEach(async ({ page }) => {
	await shot(page);
});

test("signed in get personal quote on the home page opens the quote form", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("link", { name: "Get personal quote" }).click();

	await page.waitForURL("/quotes");
	await expect(page.getByRole("form", { name: "Quote form" })).toBeVisible();
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
