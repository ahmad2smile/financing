import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import QuoteCalculator from "./quote-calculator";

export default async function Home() {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session?.user)
		return (
			<main className="flex flex-1 items-center justify-center px-4 py-6">
				<div className="w-full max-w-xl rounded-3xl bg-white px-6 py-10 text-center shadow-2xl shadow-black/20 sm:px-8">
					<h1 className="text-[26px] font-bold">Finance your solar system</h1>
					<p className="mt-2 text-sm leading-relaxed">
						Get a system price, a risk band and three installment offers made for you.
					</p>

					{/* Signs in first, then comes back here to the quote form.
					    A plain link: Link would prefetch /sign-in, and that starts a Keycloak sign in. */}
					<a
						href={`/sign-in?${new URLSearchParams({ callbackUrl: "/" })}`}
						className="bg-brand hover:bg-brand-dark mt-6 inline-block rounded-full px-6 py-3 font-semibold text-white shadow"
					>
						Get personal quote
					</a>
				</div>
			</main>
		);

	return (
		<main className="flex flex-1 items-center justify-center px-4 py-6">
			<div className="w-full max-w-5xl rounded-3xl bg-white px-6 pb-8 shadow-2xl shadow-black/20 sm:px-8">
				<div className="mx-auto max-w-xl pt-8 text-center">
					<h1 className="text-[26px] font-bold">Calculate your financing options!</h1>
					<p className="mt-2 text-sm leading-relaxed">
						Enter your details to get a system price, a risk band and three installment offers.
					</p>
				</div>

				<QuoteCalculator owner={{ fullName: session.user.name, email: session.user.email }} />
			</div>
		</main>
	);
}
