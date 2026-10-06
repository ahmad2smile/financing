import type { Page } from "@playwright/test";

// Cookies of a signed-in testUser, written by auth.setup.ts
export const signedInState = "e2e/.auth/user.json";

// Matches the user seeded in docker/keycloak/financing-realm.json
export const testUser = { name: "Test User", email: "user@test.com", password: "user" };

// Fills the Keycloak login page that the app sent the browser to
export async function loginOnKeycloak(page: Page, user: { email: string; password: string } = testUser) {
	await page.waitForURL(/localhost:8080\/realms\/financing\//);
	await page.locator("#username").fill(user.email);
	await page.locator("#password").fill(user.password);
	await page.locator("#kc-login").click();
}

// Opens a protected app page signed out, signs in on Keycloak, ends back on that page
export async function signInAt(page: Page, path: string, user: { email: string; password: string } = testUser) {
	await page.goto(path);
	await loginOnKeycloak(page, user);
	await page.waitForURL(path);
}

// Starts on an app page with the "Sign in" button, ends back on the app signed in
export async function signInWithKeycloak(page: Page, user: { email: string; password: string } = testUser) {
	await page.getByRole("button", { name: "Sign in" }).click();
	await loginOnKeycloak(page, user);
	await page.waitForURL((url) => url.port === "3100");
}
