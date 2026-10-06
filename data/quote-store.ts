import { db } from "./db";
import type { Band, Quote, QuoteBody } from "@/lib/quote";

// How each band is saved in quote.band. Saved rows keep these numbers forever: never renumber, only add.
// Record<Band, ...> makes a new band in lib/quote.ts fail to compile until it gets a number here.
export const BAND_CODE: Record<Band, number> = { A: 0, B: 1, C: 2 };
const BAND_BY_CODE = new Map(Object.entries(BAND_CODE).map(([band, code]) => [code, band as Band]));

export type SavedQuote = {
	id: string;
	createdAt: Date;
	ownerEmail: string;
	address: string;
	monthlyConsumptionKwh: number;
	systemSizeKw: number;
	downPayment: number;
	systemPrice: number;
	band: Band;
	offers: { termYears: number; apr: number; monthlyPayment: number }[];
};

// Reads one page of quotes, newest first, as userId (row level security: docker/postgres/03-quotes.sql).
// "user": only userId's own quotes, also for an admin. "admin": every quote userId may read, so all of them for an admin.
// Only the asked page leaves the database. total counts every quote in scope, for the page links.
export async function listQuotes(
	userId: string,
	scope: "admin" | "user",
	page: number,
	pageSize: number,
): Promise<{ quotes: SavedQuote[]; total: number }> {
	const client = await db.connect();
	let broken: Error | undefined;

	try {
		// The transaction only scopes app.user_id below. A quote saved between the count and the page may shift the count by one.
		await client.query("BEGIN READ ONLY");
		await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

		const where = scope === "user" ? "WHERE q.user_id = app_user_id()" : "";

		const count = await client.query<{ total: number }>(`
			SELECT count(*)::integer AS total
			FROM quote q
			${where}
		`);

		const { rows } = await client.query(
			`
			SELECT
				q.id,
				q.created_at,
				u.email,
				q.address,
				q.monthly_consumption_kwh,
				q.system_size_kw,
				q.down_payment,
				q.system_price,
				q.band,
				(
					SELECT json_agg(
						json_build_object(
							'termYears', o.term_years,
							'apr', o.apr,
							'monthlyPayment', o.monthly_payment
						)
						ORDER BY o.term_years
					)
					FROM quote_offer o
					WHERE o.quote_id = q.id
				) AS offers
			FROM quote q
			JOIN "user" u ON u.id = q.user_id
			${where}
			ORDER BY q.created_at DESC, q.id DESC
			LIMIT $1 OFFSET $2
			`,
			[pageSize, (page - 1) * pageSize],
		);

		await client.query("COMMIT");

		// pg gives numeric columns as strings. Amounts are below 2^53, so Number keeps every cent.
		const quotes = rows.map((row) => {
			const band = BAND_BY_CODE.get(row.band);
			if (!band) throw new Error(`Quote ${row.id} has band code ${row.band}, which BAND_CODE does not know`);

			return {
				id: row.id,
				createdAt: row.created_at,
				ownerEmail: row.email,
				address: row.address,
				monthlyConsumptionKwh: Number(row.monthly_consumption_kwh),
				systemSizeKw: Number(row.system_size_kw),
				downPayment: Number(row.down_payment),
				systemPrice: Number(row.system_price),
				band,
				offers: row.offers ?? [],
			};
		});

		return { quotes, total: count.rows[0].total };
	} catch (error) {
		await client.query("ROLLBACK").catch((rollbackError: Error) => {
			console.error("listQuotes ROLLBACK failed", rollbackError);
			broken = rollbackError;
		});
		throw error;
	} finally {
		client.release(broken);
	}
}

// Saves a quote and its offers in one transaction, owned by userId (row level security: docker/postgres/03-quotes.sql).
// A retry with the same requestId saves nothing.
export async function saveQuote(userId: string, input: QuoteBody, quote: Quote): Promise<void> {
	const client = await db.connect();
	let broken: Error | undefined;

	try {
		await client.query("BEGIN");
		await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

		const { rows } = await client.query<{ id: string }>(
			`INSERT INTO quote (request_id, address, monthly_consumption_kwh, system_size_kw, down_payment, system_price, principal, band)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 ON CONFLICT (user_id, request_id) DO NOTHING RETURNING id`,
			[
				input.requestId,
				input.address,
				input.monthlyConsumptionKwh,
				input.systemSizeKw,
				input.downPayment,
				quote.systemPrice,
				quote.offers[0].principalUsed,
				BAND_CODE[quote.band],
			],
		);

		// No row: an earlier try already saved it
		if (rows[0])
			await client.query(
				`INSERT INTO quote_offer (quote_id, term_years, apr, monthly_payment)
				 SELECT $1, * FROM unnest($2::integer[], $3::numeric[], $4::numeric[])`,
				[
					rows[0].id,
					quote.offers.map((o) => o.termYears),
					quote.offers.map((o) => o.apr),
					quote.offers.map((o) => o.monthlyPayment),
				],
			);

		await client.query("COMMIT");
	} catch (error) {
		// A failed ROLLBACK means the connection is bad: drop it from the pool instead of reusing it
		await client.query("ROLLBACK").catch((rollbackError: Error) => {
			console.error("saveQuote ROLLBACK failed", rollbackError);
			broken = rollbackError;
		});
		throw error;
	} finally {
		client.release(broken);
	}
}
