import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getQuote } from "@/data/quote-store";
import { auth } from "@/lib/auth";
import LocalTime from "../local-time";

export const metadata: Metadata = { title: "Quote details" };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const card = "rounded-xl border border-zinc-200 p-4";

// One saved quote, for its owner or an admin. Row level security hides it from everyone else,
// so missing, not yours and a bad id are all the same 404, like GET /api/quotes/[id].
export default async function QuoteDetailsPage({ params }: PageProps<"/quotes/[id]">) {
	const { id } = await params;

	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) redirect(`/sign-in?${new URLSearchParams({ callbackUrl: `/quotes/${id}` })}`);

	const quote = await getQuote(session.user.id, id);
	if (!quote) notFound();

	// An admin looking at someone else's quote came from All quotes
	const own = quote.ownerEmail === session.user.email;
	const back = own ? { href: "/quotes", label: "My quotes" } : { href: "/admin/quotes", label: "All quotes" };

	const details = [
		{ term: "Date", value: <LocalTime value={quote.createdAt} /> },
		{ term: "Owner", value: quote.ownerEmail },
		{ term: "Address", value: quote.address },
		{ term: "Monthly consumption", value: `${number.format(quote.monthlyConsumptionKwh)} kWh` },
		{ term: "System size", value: `${number.format(quote.systemSizeKw)} kW` },
		{ term: "Down payment", value: money.format(quote.downPayment) },
		{ term: "Financed amount", value: money.format(quote.principal) },
	];

	return (
		<main className="flex flex-1 justify-center px-4 py-6">
			<div className="w-full max-w-3xl rounded-3xl bg-white px-6 py-8 shadow-2xl shadow-black/20 sm:px-8">
				<Link href={back.href} className="text-brand text-sm font-semibold hover:underline">
					← Back to {back.label}
				</Link>
				<h1 className="mt-2 mb-6 text-[26px] font-bold">Quote details</h1>

				<div className="grid gap-6">
					<dl className="grid grid-cols-2 gap-4">
						<div className={card}>
							<dt className="text-sm text-zinc-500">System price</dt>
							<dd className="text-2xl font-bold">{money.format(quote.systemPrice)}</dd>
						</div>
						<div className={card}>
							<dt className="text-sm text-zinc-500">Risk band</dt>
							<dd className="text-2xl font-bold">{quote.band}</dd>
						</div>
					</dl>

					<dl aria-label="Quote inputs" className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
						{details.map((d) => (
							<div key={d.term} className="contents">
								<dt className="text-sm text-zinc-500">{d.term}</dt>
								<dd className="text-sm font-medium break-words">{d.value}</dd>
							</div>
						))}
					</dl>

					<table className="w-full text-left">
						<caption className="pb-2 text-left text-lg font-bold">Installment offers</caption>
						<thead>
							<tr className="border-b border-zinc-300 text-sm text-zinc-500">
								<th scope="col" className="py-2">
									Term
								</th>
								<th scope="col">APR</th>
								<th scope="col" className="text-right">
									Monthly payment
								</th>
							</tr>
						</thead>
						<tbody>
							{quote.offers.map((offer) => (
								<tr key={offer.termYears} className="border-b border-zinc-200 text-sm">
									<th scope="row" className="py-2 font-normal">
										{offer.termYears} years
									</th>
									<td>{offer.apr}%</td>
									<td className="text-right font-semibold">{money.format(offer.monthlyPayment)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</main>
	);
}
