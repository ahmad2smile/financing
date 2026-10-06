import path from "node:path";
import { expect, test } from "@playwright/test";

// Runs against the broken server (see playwright.config.ts): every page and API call throws an error
// nobody catches. Next answers those with a generic 500 and never shows the error itself.

test("uncaught error on a page shows our error page with status 500, not the Next default", async ({ page }) => {
	for (const url of ["/", "/quotes"]) {
		const response = await page.goto(url);

		expect(response?.status()).toBe(500);
		await expect(page.getByRole("heading", { name: "Service unavailable" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
		await expect(page.getByText("Application error")).toHaveCount(0);
		await expect(page.getByText("ECONNREFUSED")).toHaveCount(0);
	}

	await page.screenshot({
		path: path.join(test.info().project.testDir, "screenshots", "server error page.png"),
		fullPage: true,
	});
});

test("uncaught error in the API gives a generic 500 without the error details", async ({ page }) => {
	const response = await page.request.post("/api/quotes", {
		data: { address: "1 Main St", monthlyConsumptionKwh: 500, systemSizeKw: 10 },
	});

	expect(response.status()).toBe(500);
	expect(await response.text()).not.toContain("ECONNREFUSED");
});
