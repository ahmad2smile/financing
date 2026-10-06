import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import QuoteCalculator from "./quote-calculator";

export default async function QuotesPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) redirect(`/sign-in?${new URLSearchParams({ callbackUrl: "/quotes" })}`);

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
