import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function fill(page: Page, values: Partial<Record<string, string>> = {}) {
  const all = {
    "Full name": "Jane Doe",
    Email: "jane@test.com",
    Address: "1 Main St",
    "Monthly consumption (kWh)": "500",
    "System size (kW)": "10",
    "Down payment (USD, optional)": "",
    ...values,
  };
  for (const [label, value] of Object.entries(all))
    await page.getByLabel(label).fill(value ?? "");
}

const submit = (page: Page) =>
  page.getByRole("button", { name: "Get pre-qualification" }).click();
// Next adds its own empty role=alert announcer, so look inside the form
const alert = (page: Page) =>
  page.getByRole("form", { name: "Quote form" }).getByRole("alert");
const results = (page: Page) =>
  page.getByRole("region", { name: "Quote results" });

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

test("down payment with thousands commas is used, not dropped", async ({
  page,
}) => {
  await fill(page, { "Down payment (USD, optional)": "5,000" });
  await submit(page);

  await expect(results(page)).toContainText("$12,000.00");
  await expect(results(page)).toContainText("Financed amount: $7,000.00");
});

test("blank form shows required errors but no down payment error", async ({
  page,
}) => {
  await submit(page);

  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByLabel("System size (kW)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(
    page.getByLabel("Down payment (USD, optional)"),
  ).not.toHaveAttribute("aria-invalid");
});

test("bad number text shows an error and sends nothing", async ({ page }) => {
  let requests = 0;
  await page.route("/api/quotes", (route) => (requests++, route.continue()));

  await fill(page, { "Down payment (USD, optional)": "5e3" });
  await submit(page);

  await expect(
    page.getByText("Enter 0 or more, with at most 2 decimals (cents)."),
  ).toBeVisible();
  expect(requests).toBe(0);
});

test("server error with an HTML body shows a server problem", async ({
  page,
}) => {
  await page.route("/api/quotes", (route) =>
    route.fulfill({ status: 500, body: "<html>Internal Server Error</html>" }),
  );

  await fill(page);
  await submit(page);

  await expect(alert(page)).toHaveText(
    "The server had a problem (status 500). Please try again.",
  );
});

test("server error with JSON but no field errors still shows a message", async ({
  page,
}) => {
  await page.route("/api/quotes", (route) =>
    route.fulfill({ status: 502, json: { message: "Bad gateway" } }),
  );

  await fill(page);
  await submit(page);

  await expect(alert(page)).toHaveText(
    "The server had a problem (status 502). Please try again.",
  );
});

test("request-level error from the server shows in the alert", async ({
  page,
}) => {
  await page.route("/api/quotes", (route) =>
    route.fulfill({
      status: 400,
      json: { errors: { form: "Request body must be valid JSON." } },
    }),
  );

  await fill(page);
  await submit(page);

  await expect(alert(page)).toHaveText("Request body must be valid JSON.");
});

test("success body that is not a quote is not shown", async ({ page }) => {
  await page.route("/api/quotes", (route) =>
    route.fulfill({ status: 200, json: { offers: [] } }),
  );

  await fill(page);
  await submit(page);

  await expect(alert(page)).toHaveText(
    "The server had a problem (status 200). Please try again.",
  );
  await expect(results(page)).toContainText(
    "Fill in the form to see your offers.",
  );
});

test("network failure shows a connection message", async ({ page }) => {
  await page.route("/api/quotes", (route) => route.abort());

  await fill(page);
  await submit(page);

  await expect(alert(page)).toHaveText(
    "Could not reach the server. Please try again.",
  );
});

test("editing after a quote marks the offers out of date until resubmit", async ({
  page,
}) => {
  await fill(page);
  await submit(page);
  await expect(results(page)).toContainText("$12,000.00");

  await page.getByLabel("System size (kW)").fill("5");
  await expect(page.getByRole("status")).toContainText(
    "These offers are out of date",
  );
  await shot(page, "out of date");

  await submit(page);
  await expect(results(page)).toContainText("$6,000.00");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("server field errors show under their field, unknown ones in the alert", async ({
  page,
}) => {
  await page.route("/api/quotes", (route) =>
    route.fulfill({
      status: 422,
      json: {
        errors: {
          systemSizeKw: "Size rejected by server.",
          extra: "Odd field.",
        },
      },
    }),
  );

  await fill(page);
  await submit(page);

  await expect(page.getByText("Size rejected by server.")).toBeVisible();
  await expect(page.getByLabel("System size (kW)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(alert(page)).toHaveText("Odd field.");
});

test("errors update while typing after the first submit", async ({ page }) => {
  await submit(page);
  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await shot(page, "before typing");

  await page.getByLabel("Full name").fill("Jane Doe");
  await expect(page.getByText("Enter your full name.")).toHaveCount(0);
});
