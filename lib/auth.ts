import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, keycloak } from "better-auth/plugins";
import { db } from "./db";

// Secret and app URL come from BETTER_AUTH_SECRET and BETTER_AUTH_URL.
// Users, accounts and sessions live in Postgres (schema in docker/postgres/02-auth.sql).
export const auth = betterAuth({
	database: db,
	plugins: [
		genericOAuth({
			config: [
				{
					...keycloak({
						issuer: process.env.KEYCLOAK_ISSUER!,
						clientId: process.env.KEYCLOAK_CLIENT_ID!,
						clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
						// Keycloak is the one source of truth: copy name and email again on every sign in
						overrideUserInfo: true,
					}),
					// The quote form shows this as "Full name". The realm requires both parts
					// (docker/keycloak/financing-realm.json), so a missing one is a broken setup: fail the sign in.
					mapProfileToUser: ({ given_name, family_name }) => {
						if (!given_name || !family_name) throw new Error("Keycloak sent no first or last name");
						return { name: `${given_name} ${family_name}` };
					},
				},
			],
		}),
		// Lets server actions and route handlers set the auth cookies. Must stay last.
		nextCookies(),
	],
});
