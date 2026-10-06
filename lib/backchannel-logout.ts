import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

// Keycloak's signing keys, made on first use so importing this needs no env.
// jose caches them and fetches again when a token has a new key id.
let remoteKeys: JWTVerifyGetKey | undefined;
const keycloakKeys: JWTVerifyGetKey = (header, token) =>
	(remoteKeys ??= createRemoteJWKSet(new URL(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`)))(
		header,
		token,
	);

// Checks a logout_token as OIDC Back-Channel Logout 1.0 (section 2.6) asks, and returns the Keycloak user id.
// Throws: a bad token gives a JOSEError, see isBadToken. Not getting Keycloak's keys gives anything else.
export async function verifyLogoutToken(token: string, keys: JWTVerifyGetKey = keycloakKeys): Promise<string> {
	const { payload } = await jwtVerify(token, keys, {
		issuer: process.env.KEYCLOAK_ISSUER,
		audience: process.env.KEYCLOAK_CLIENT_ID,
		maxTokenAge: "5 minutes",
		requiredClaims: ["iat", "sub"],
	});

	const events = payload.events as Record<string, unknown> | undefined;
	if (typeof events?.[LOGOUT_EVENT] !== "object") {
		throw new errors.JWTClaimValidationFailed("Not a back-channel logout token", payload, "events", "check_failed");
	}
	if ("nonce" in payload) {
		throw new errors.JWTClaimValidationFailed("Logout token must not have a nonce", payload, "nonce", "check_failed");
	}

	return payload.sub!;
}

// The sender's fault (400) vs ours (let it throw, generic 500). Keycloak's keys failing to load is ours.
export const isBadToken = (error: unknown) =>
	error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid);
