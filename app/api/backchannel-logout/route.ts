import { auth } from "@/lib/auth";
import { isBadToken, verifyLogoutToken } from "@/lib/backchannel-logout";

const noStore = { "Cache-Control": "no-store" };

// Keycloak calls this when one of its sessions ends (admin console, other app, timeout, our own sign out).
// Its URL is set on the client in docker/keycloak/financing-realm.json.
// Keycloak only sends the user, so every app session of that user ends, on all devices.
export async function POST(request: Request) {
	const form = await request.formData().catch(() => undefined);
	const token = form?.get("logout_token");
	if (typeof token !== "string") {
		console.warn("POST /api/backchannel-logout rejected: no logout_token");
		return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
	}

	let keycloakUserId: string;
	try {
		keycloakUserId = await verifyLogoutToken(token);
	} catch (error) {
		if (!isBadToken(error)) throw error;
		console.warn("POST /api/backchannel-logout rejected: invalid logout_token", error);
		return Response.json({ error: "invalid_request" }, { status: 400, headers: noStore });
	}

	const { internalAdapter } = await auth.$context;
	const account = await internalAdapter.findAccountByKey({ providerId: "keycloak", accountId: keycloakUserId });
	if (account) await internalAdapter.deleteUserSessions(account.userId);
	console.info(`Back-channel logout: ended app sessions of Keycloak user ${keycloakUserId}`, { found: !!account });

	return new Response(null, { status: 200, headers: noStore });
}
