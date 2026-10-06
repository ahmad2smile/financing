import { notFound } from "next/navigation";
import { z } from "zod";
import { listQuotes } from "@/data/quote-store";
import QuotesTable from "./quotes-table";

const PAGE_SIZE = 10;

const SCOPES = {
	user: { title: "My quotes", path: "/quotes" },
	admin: { title: "All quotes", path: "/admin/quotes" },
} as const;

// ?page= from the URL. Missing means page 1, anything that is not a page number is a 404.
const pageSchema = z
	.string()
	.regex(/^[1-9]\d{0,5}$/)
	.transform(Number)
	.optional()
	.default(1);

// The server half of the quote list: page number and one page from Postgres. The table itself runs in the browser.
// The page checks sign in (and admin for "admin") before it renders this.
export default async function Quotes({
	scope,
	userId,
	searchParams,
}: {
	scope: keyof typeof SCOPES;
	userId: string;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { title, path } = SCOPES[scope];

	const parsed = pageSchema.safeParse((await searchParams).page);
	if (!parsed.success) notFound();
	const page = parsed.data;

	const { quotes, total } = await listQuotes(userId, scope, page, PAGE_SIZE);
	const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
	if (page > pages) notFound();

	return (
		<main className="flex flex-1 justify-center px-4 py-6">
			<div className="w-full max-w-6xl rounded-3xl bg-white px-6 py-8 shadow-2xl shadow-black/20 sm:px-8">
				<h1 className="mb-4 text-[26px] font-bold">{title}</h1>
				<QuotesTable
					quotes={quotes}
					total={total}
					page={page}
					pages={pages}
					path={path}
					showOwner={scope === "admin"}
				/>
			</div>
		</main>
	);
}
