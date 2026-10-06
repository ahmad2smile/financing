import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Starts the Keycloak sign in straight away, so protected pages can redirect here.
// Only this site is followed after sign in, anything else goes to "/".
// Better Auth skips its own callbackURL check for server calls, so run the same check here.
export async function GET(request: Request) {
	const asked = new URL(request.url).searchParams.get("callbackUrl") ?? "/";
	const context = await auth.$context;
	const callbackURL = context.isTrustedOrigin(asked, { allowRelativePaths: true }) ? asked : "/";

	const { url } = await auth.api.signInSocial({
		headers: await headers(),
		body: { provider: "keycloak", callbackURL },
	});

	redirect(url!);
}
