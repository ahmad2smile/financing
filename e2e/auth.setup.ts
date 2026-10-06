import { expect, test as setup } from "@playwright/test";
import { signedInState, signInWithKeycloak, testUser } from "./sign-in";

// Signs in once and saves the cookies, so signed-in tests skip the Keycloak page
setup("sign in", async ({ page }) => {
	await page.goto("/");
	await signInWithKeycloak(page);
	await expect(page.getByText(testUser.email)).toBeVisible();

	await page.context().storageState({ path: signedInState });
});
