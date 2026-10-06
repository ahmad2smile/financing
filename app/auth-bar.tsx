import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function AuthBar() {
	const session = await auth.api.getSession({ headers: await headers() });

	return (
		<header className="flex items-center justify-end gap-3 px-4 pt-4 text-sm">
			{session?.user ? (
				<>
					<span className="rounded-full bg-white/80 px-3 py-1.5">{session.user.email}</span>
					<form
						action={async () => {
							"use server";
							// Ends the app session, then Keycloak's. Without the second step,
							// the next "Sign in" would log the user straight back in without a password.
							const { url } = await auth.api.signOut({
								headers: await headers(),
								body: { callbackURL: "/", disableRedirect: true },
							});
							redirect(url ?? "/");
						}}
					>
						<button className="rounded-full bg-white px-4 py-1.5 font-semibold shadow hover:bg-gray-50">
							Sign out
						</button>
					</form>
				</>
			) : (
				<form
					action={async () => {
						"use server";
						// Comes back to the page the button was on
						const referer = (await headers()).get("referer");
						const callbackUrl = referer ? new URL(referer).pathname : "/";
						redirect(`/sign-in?${new URLSearchParams({ callbackUrl })}`);
					}}
				>
					<button className="bg-brand hover:bg-brand-dark rounded-full px-4 py-1.5 font-semibold text-white shadow">
						Sign in
					</button>
				</form>
			)}
		</header>
	);
}
