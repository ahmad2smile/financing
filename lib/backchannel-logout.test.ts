import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { isBadToken, verifyLogoutToken } from "./backchannel-logout";

const issuer = "http://keycloak.test/realms/financing";
const audience = "financing-web";
const event = { "http://schemas.openid.net/event/backchannel-logout": {} };

let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
	process.env.KEYCLOAK_ISSUER = issuer;
	process.env.KEYCLOAK_CLIENT_ID = audience;

	const pair = await generateKeyPair("RS256");
	privateKey = pair.privateKey;
	otherKey = (await generateKeyPair("RS256")).privateKey;
	keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" }] });
});

// A valid Keycloak logout token, with overrides
function token(claims: Record<string, unknown> = {}, { key = privateKey, iat = Math.floor(Date.now() / 1000) } = {}) {
	return new SignJWT({ iss: issuer, aud: audience, sub: "kc-user-1", events: event, sid: "kc-session-1", ...claims })
		.setProtectedHeader({ alg: "RS256", kid: "k1", typ: "logout+jwt" })
		.setIssuedAt(iat)
		.setJti("jti-1")
		.sign(key);
}

it("valid token gives the Keycloak user id", async () => {
	expect(await verifyLogoutToken(await token(), keys)).toBe("kc-user-1");
});

it.each([
	["signed with another key", () => token({}, { key: otherKey })],
	["wrong issuer", () => token({ iss: "http://evil.test/realms/financing" })],
	["wrong audience", () => token({ aud: "other-client" })],
	["older than 5 minutes", () => token({}, { iat: Math.floor(Date.now() / 1000) - 6 * 60 })],
	["no logout event", () => token({ events: {} })],
	["has a nonce, so it is a login id_token", () => token({ nonce: "n" })],
	["no user", () => token({ sub: undefined })],
	["not a JWT", async () => "not-a-jwt"],
])("rejected as a bad token: %s", async (_, make) => {
	const error = await verifyLogoutToken(await make(), keys).catch((e: unknown) => e);

	expect(isBadToken(error)).toBe(true);
});

it("Keycloak keys not loading is not the sender's fault", async () => {
	const down: JWTVerifyGetKey = async () => {
		throw new TypeError("fetch failed");
	};

	const error = await verifyLogoutToken(await token(), down).catch((e: unknown) => e);

	expect(error).toBeInstanceOf(TypeError);
	expect(isBadToken(error)).toBe(false);
});
