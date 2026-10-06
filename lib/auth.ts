import { betterAuth, type Account, type GenericEndpointContext } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, keycloak } from "better-auth/plugins";
import { decodeJwt } from "jose";
import { db } from "@/data/db";

// Keycloak is the one source of truth for roles too. Better Auth saves the verified ID token on the account
// at every sign in, so copy the role from it then. The "roles" claim comes from docker/keycloak/financing-realm.json.
// No token or no admin role means "user", never "admin". After-hooks run once the sign in is committed.
// Sign in always runs in an endpoint, so a missing context is a bug: fail loudly rather than keep a stale role.
async function copyRole(account: Account, ctx: GenericEndpointContext | null) {
	if (!ctx) throw new Error(`copyRole got no endpoint context, role of user ${account.userId} not copied`);

	const roles = account.idToken ? decodeJwt(account.idToken).roles : undefined;
	const role = Array.isArray(roles) && roles.includes("admin") ? "admin" : "user";

	await ctx.context.internalAdapter.updateUser(account.userId, { role });
}

// Secret and app URL come from BETTER_AUTH_SECRET and BETTER_AUTH_URL.
// Users, accounts and sessions live in Postgres (schema in docker/postgres/02-auth.sql).
export const auth = betterAuth({
	database: db,
	user: {
		additionalFields: {
			// Row level security on quotes reads it (docker/postgres/03-quotes.sql). input: false, so no request can set it.
			role: { type: "string", required: true, defaultValue: "user", input: false },
		},
	},
	databaseHooks: {
		account: { create: { after: copyRole }, update: { after: copyRole } },
	},
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
					// The server may reach Keycloak at another address than the browser does (keycloak:8080 in Docker).
					// Keycloak answers there with its token and key URLs on that address, and the public issuer.
					discoveryUrl: `${process.env.KEYCLOAK_INTERNAL_URL || process.env.KEYCLOAK_ISSUER}/.well-known/openid-configuration`,
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
