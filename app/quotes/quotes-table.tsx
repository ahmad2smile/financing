"use client";

// The quote table, in the browser so dates show in the viewer's own time zone. Data comes from quotes.tsx.
// Paging is in Postgres and the URL (?page=) holds the page number, so the page buttons are plain links.
import { cn } from "cn";
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SavedQuote } from "@/data/quote-store";
import { TERMS } from "@/lib/quote";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
// No timeZone: the browser's own. Only used in the browser, see LocalTime.
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const noSubscribe = () => () => {};

// The server renders this first and does not know the viewer's time zone, so it shows no text until the browser
// takes over. useSyncExternalStore gives false on the server and while hydrating, then true, so there is no mismatch.
function LocalTime({ value }: { value: Date }) {
	const inBrowser = useSyncExternalStore(
		noSubscribe,
		() => true,
		() => false,
	);

	return <time dateTime={value.toISOString()}>{inBrowser ? date.format(value) : null}</time>;
}

// Numbers are right aligned, so they line up under their header
type Column = { header: string; numeric?: boolean; cell: (quote: SavedQuote) => ReactNode };

const ownerColumn: Column = { header: "Owner", cell: (q) => q.ownerEmail };

const columns: Column[] = [
	{ header: "Date", cell: (q) => <LocalTime value={q.createdAt} /> },
	{
		header: "Address",
		cell: (q) => (
			<div className="max-w-64 truncate" title={q.address}>
				{q.address}
			</div>
		),
	},
	{ header: "Consumption (kWh)", numeric: true, cell: (q) => number.format(q.monthlyConsumptionKwh) },
	{ header: "Size (kW)", numeric: true, cell: (q) => number.format(q.systemSizeKw) },
	{ header: "System price", numeric: true, cell: (q) => money.format(q.systemPrice) },
	{ header: "Down payment", numeric: true, cell: (q) => money.format(q.downPayment) },
	{ header: "Band", cell: (q) => q.band },
	...TERMS.map((term): Column => ({
		header: `${term} years / month`,
		numeric: true,
		cell: (q) => {
			const offer = q.offers.find((o) => o.termYears === term);
			return <span className="font-semibold">{offer ? money.format(offer.monthlyPayment) : "-"}</span>;
		},
	})),
];

const columnsWithOwner = [columns[0], ownerColumn, ...columns.slice(1)];

// A link to page n, or a disabled button when there is nowhere to go
function PageLink({ label, href }: { label: string; href: string | null }) {
	if (!href)
		return (
			<Button variant="outline" size="sm" disabled>
				{label}
			</Button>
		);

	return (
		// cn, like shadcn's Button, so the outline border wins over the base transparent one
		<Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
			{label}
		</Link>
	);
}

export default function QuotesTable({
	quotes,
	total,
	page,
	pages,
	path,
	showOwner,
}: {
	quotes: SavedQuote[];
	total: number;
	page: number;
	pages: number;
	path: string;
	showOwner: boolean;
}) {
	const shown = showOwner ? columnsWithOwner : columns;
	const toPage = (n: number, can: boolean) => (can ? `${path}?page=${n}` : null);

	return (
		<>
			<div className="overflow-hidden rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							{shown.map((c) => (
								<TableHead key={c.header} className={c.numeric ? "text-right" : undefined}>
									{c.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{quotes.length ? (
							quotes.map((quote) => (
								<TableRow key={quote.id}>
									{shown.map((c) => (
										<TableCell key={c.header} className={c.numeric ? "text-right" : undefined}>
											{c.cell(quote)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={shown.length} className="h-24 text-center">
									No quotes yet.{" "}
									<Link href="/" className="text-brand font-semibold hover:underline">
										Get a quote
									</Link>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>

			<div className="flex items-center justify-between py-4">
				<div className="text-muted-foreground text-sm">
					Page {page} of {pages} · {total} quotes
				</div>
				<nav aria-label="Pages" className="flex items-center justify-end space-x-2">
					<PageLink label="First" href={toPage(1, page > 1)} />
					<PageLink label="Previous" href={toPage(page - 1, page > 1)} />
					<PageLink label="Next" href={toPage(page + 1, page < pages)} />
					<PageLink label="Last" href={toPage(pages, page < pages)} />
				</nav>
			</div>
		</>
	);
}
