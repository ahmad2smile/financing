import type { PoolClient } from "pg";
import { z } from "zod";
import { db } from "./db";
import { logger } from "@/lib/log";
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
	principal: number;
	band: Band;
	offers: { termYears: number; apr: number; monthlyPayment: number }[];
};

// Runs fn in one transaction as userId (row level security: docker/postgres/03-quotes.sql)
async function asUser<T>(
	userId: string,
	begin: "BEGIN" | "BEGIN READ ONLY",
	fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await db.connect();
	let broken: Error | undefined;

	try {
		await client.query(begin);
		await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

		const result = await fn(client);

		await client.query("COMMIT");
		return result;
	} catch (error) {
		// A failed ROLLBACK means the connection is bad: drop it from the pool instead of reusing it
		await client.query("ROLLBACK").catch((rollbackError: Error) => {
			logger.error({ err: rollbackError }, "quote store ROLLBACK failed");
			broken = rollbackError;
		});
		throw error;
	} finally {
		client.release(broken);
	}
}

// One saved quote with its owner and offers. Add WHERE, ORDER BY and LIMIT after it.
const SELECT_QUOTE = `
	SELECT
		q.id,
		q.created_at,
		u.email,
		q.address,
		q.monthly_consumption_kwh,
		q.system_size_kw,
		q.down_payment,
		q.system_price,
		q.principal,
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
`;

// pg gives numeric columns as strings. json_agg gives JSON numbers.
type QuoteRow = {
	id: string;
	created_at: Date;
	email: string;
	address: string;
	monthly_consumption_kwh: string;
	system_size_kw: string;
	down_payment: string;
	system_price: string;
	principal: string;
	band: number;
	offers: SavedQuote["offers"] | null;
};

// Amounts are below 2^53, so Number keeps every cent
function toSavedQuote(row: QuoteRow): SavedQuote {
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
		principal: Number(row.principal),
		band,
		offers: row.offers ?? [],
	};
}

// Reads one page of quotes, newest first, as userId.
// "user": only userId's own quotes, also for an admin. "admin": every quote userId may read, so all of them for an admin.
// Only the asked page leaves the database. total counts every quote in scope, for the page links.
export function listQuotes(
	userId: string,
	scope: "admin" | "user",
	page: number,
	pageSize: number,
): Promise<{ quotes: SavedQuote[]; total: number }> {
	// The transaction only scopes app.user_id. A quote saved between the count and the page may shift the count by one.
	return asUser(userId, "BEGIN READ ONLY", async (client) => {
		const where = scope === "user" ? "WHERE q.user_id = app_user_id()" : "";

		const count = await client.query<{ total: number }>(`SELECT count(*)::integer AS total FROM quote q ${where}`);

		const { rows } = await client.query<QuoteRow>(
			`${SELECT_QUOTE} ${where} ORDER BY q.created_at DESC, q.id DESC LIMIT $1 OFFSET $2`,
			[pageSize, (page - 1) * pageSize],
		);

		return { quotes: rows.map(toSavedQuote), total: count.rows[0].total };
	});
}

// Reads one quote as userId. Row level security hides other users' quotes from a non-admin,
// so null means either "no such quote" or "not yours", and callers can't tell them apart.
// id comes from the URL. Text that is not a UUID would make Postgres throw, so it is null too.
export async function getQuote(userId: string, id: string): Promise<SavedQuote | null> {
	if (!z.uuid().safeParse(id).success) return null;

	return asUser(userId, "BEGIN READ ONLY", async (client) => {
		const { rows } = await client.query<QuoteRow>(`${SELECT_QUOTE} WHERE q.id = $1`, [id]);

		return rows[0] ? toSavedQuote(rows[0]) : null;
	});
}

// Saves a quote and its offers in one transaction, owned by userId. A retry with the same requestId saves nothing.
export function saveQuote(userId: string, input: QuoteBody, quote: Quote): Promise<void> {
	return asUser(userId, "BEGIN", async (client) => {
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
	});
}
