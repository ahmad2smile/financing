import { db } from "./db";
import type { Band, Quote, QuoteBody } from "@/lib/quote";

// How each band is saved in quote.band. Saved rows keep these numbers forever: never renumber, only add.
// Record<Band, ...> makes a new band in lib/quote.ts fail to compile until it gets a number here.
export const BAND_CODE: Record<Band, number> = { A: 0, B: 1, C: 2 };

// Saves a quote and its offers as one row set, owned by userId. Tables and row level security
// are in docker/postgres/03-quotes.sql: app.user_id tells Postgres who is asking, for this transaction only.
// Money goes in as cents-rounded numbers (lib/quote.ts) and is stored as numeric(12, 2).
export async function saveQuote(userId: string, input: QuoteBody, quote: Quote): Promise<string> {
	const client = await db.connect();
	let broken: Error | undefined;

	try {
		await client.query("BEGIN");
		await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);

		const { rows } = await client.query<{ id: string }>(
			`INSERT INTO quote (address, monthly_consumption_kwh, system_size_kw, down_payment, system_price, principal, band)
			 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
			[
				input.address,
				input.monthlyConsumptionKwh,
				input.systemSizeKw,
				input.downPayment,
				quote.systemPrice,
				quote.offers[0].principalUsed,
				BAND_CODE[quote.band],
			],
		);
		const id = rows[0].id;

		await client.query(
			`INSERT INTO quote_offer (quote_id, term_years, apr, monthly_payment)
			 SELECT $1, * FROM unnest($2::integer[], $3::numeric[], $4::numeric[])`,
			[
				id,
				quote.offers.map((o) => o.termYears),
				quote.offers.map((o) => o.apr),
				quote.offers.map((o) => o.monthlyPayment),
			],
		);

		await client.query("COMMIT");
		return id;
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
