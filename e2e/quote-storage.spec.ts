import { expect, test } from "@playwright/test";
import { Pool, type PoolClient } from "pg";

// Talks to Postgres as the app does (DATABASE_URL, the financing role). Needs `docker compose up -d`.
// Each test runs in one transaction that is rolled back, so nothing is left behind.
const db = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => db.end());

const users = { ann: "rls-ann", bob: "rls-bob", admin: "rls-admin" };

async function inRolledBackTransaction(fn: (client: PoolClient) => Promise<void>) {
	const client = await db.connect();
	try {
		await client.query("BEGIN");
		for (const [name, id] of Object.entries(users))
			await client.query(
				`INSERT INTO "user" (id, name, email, "emailVerified", role) VALUES ($1, $1, $1 || '@test.com', true, $2)`,
				[id, name === "admin" ? "admin" : "user"],
			);
		await fn(client);
	} finally {
		await client.query("ROLLBACK");
		client.release();
	}
}

// Same call data/quote-store.ts makes. null means nobody is set.
const actAs = (client: PoolClient, userId: string | null) =>
	client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);

const addQuote = async (client: PoolClient, money: { down?: string; price?: string; principal?: string } = {}) => {
	const { down = "1000.00", price = "6000.00", principal = "5000.00" } = money;
	const { rows } = await client.query(
		`INSERT INTO quote (request_id, address, monthly_consumption_kwh, system_size_kw, down_payment, system_price, principal, band)
		 VALUES (gen_random_uuid(), '1 Main St', 500, 5, $1, $2, $3, 1) RETURNING id, user_id, down_payment, system_price, principal`,
		[down, price, principal],
	);
	await client.query(
		`INSERT INTO quote_offer (quote_id, term_years, apr, monthly_payment) VALUES ($1, 5, 8.9, 103.55)`,
		[rows[0].id],
	);
	return rows[0];
};

const visible = async (client: PoolClient) => ({
	quotes: (await client.query(`SELECT user_id FROM quote ORDER BY user_id`)).rows.map((r) => r.user_id),
	offers: (await client.query(`SELECT 1 FROM quote_offer`)).rowCount,
});

// Runs fn in a savepoint and returns its error message, so the transaction goes on after an expected failure
async function errorOf(client: PoolClient, fn: () => Promise<unknown>) {
	await client.query("SAVEPOINT attempt");
	try {
		await fn();
	} catch (error) {
		await client.query("ROLLBACK TO SAVEPOINT attempt");
		return (error as Error).message;
	}
	await client.query("RELEASE SAVEPOINT attempt");
	return undefined;
}

test("the app connects as a role that row level security applies to", async () => {
	const { rows } = await db.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);

	expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
});

test("a user sees only their own quotes and offers, an admin sees all, nobody sees none", async () => {
	await inRolledBackTransaction(async (client) => {
		await actAs(client, users.ann);
		expect((await addQuote(client)).user_id).toBe(users.ann);
		await actAs(client, users.bob);
		await addQuote(client);

		await actAs(client, users.ann);
		expect(await visible(client)).toEqual({ quotes: [users.ann], offers: 1 });

		await actAs(client, users.bob);
		expect(await visible(client)).toEqual({ quotes: [users.bob], offers: 1 });

		// The admin also sees quotes other tests saved, so count only this test's users
		await actAs(client, users.admin);
		const { rows } = await client.query(
			`SELECT q.user_id, count(o.*)::int AS offers FROM quote q JOIN quote_offer o ON o.quote_id = q.id
			 WHERE q.user_id = ANY($1) GROUP BY q.user_id ORDER BY q.user_id`,
			[Object.values(users)],
		);
		expect(rows).toEqual([
			{ user_id: users.ann, offers: 1 },
			{ user_id: users.bob, offers: 1 },
		]);

		await actAs(client, null);
		expect(await visible(client)).toEqual({ quotes: [], offers: 0 });
	});
});

test("nobody adds a quote or offer for someone else, not even an admin", async () => {
	await inRolledBackTransaction(async (client) => {
		await actAs(client, users.bob);
		const bobs = await addQuote(client);
		const forBob = () =>
			client.query(
				`INSERT INTO quote (request_id, user_id, address, monthly_consumption_kwh, system_size_kw, down_payment, system_price, principal, band)
				 VALUES (gen_random_uuid(), $1, '1 Main St', 500, 5, 0, 6000, 6000, 1)`,
				[users.bob],
			);
		const offerOnBobs = () =>
			client.query(`INSERT INTO quote_offer (quote_id, term_years, apr, monthly_payment) VALUES ($1, 10, 8.9, 1)`, [
				bobs.id,
			]);

		for (const user of [users.ann, users.admin, null]) {
			await actAs(client, user);
			expect(await errorOf(client, forBob)).toMatch(/row-level security/);
			expect(await errorOf(client, offerOnBobs)).toMatch(/row-level security/);
		}
		await actAs(client, null);
		expect(await errorOf(client, () => addQuote(client))).toMatch(/row-level security/);
	});
});

test("saved quotes can not be changed or deleted, even by their owner", async () => {
	await inRolledBackTransaction(async (client) => {
		await actAs(client, users.ann);
		await addQuote(client);

		expect(await errorOf(client, () => client.query(`UPDATE quote SET band = 0`))).toMatch(/permission denied/);
		expect(await errorOf(client, () => client.query(`DELETE FROM quote_offer`))).toMatch(/permission denied/);
		expect(await errorOf(client, () => client.query(`DELETE FROM quote`))).toMatch(/permission denied/);
	});
});

test("money is kept to the cent, from 0 up to 1000x the biggest system price", async () => {
	// Postgres got its limit from the same .env value when its volume was created (docker/postgres/03-quotes.sql)
	const max = (1000 * 1000 * Number(process.env.NEXT_PUBLIC_PRICE_PER_KW)).toFixed(2);
	const overMax = (Number(max) + 0.01).toFixed(2);

	await inRolledBackTransaction(async (client) => {
		await actAs(client, users.ann);

		const top = await addQuote(client, { down: "0", price: max, principal: max });
		expect([top.down_payment, top.system_price, top.principal]).toEqual(["0.00", max, max]);

		const cent = await addQuote(client, { down: "0.01", price: "0.02", principal: "0.01" });
		expect([cent.down_payment, cent.system_price, cent.principal]).toEqual(["0.01", "0.02", "0.01"]);

		// numeric(12, 2) keeps two decimals and rounds the rest
		const rounded = await addQuote(client, { down: "0.004", price: "10.005", principal: "10.01" });
		expect([rounded.down_payment, rounded.system_price]).toEqual(["0.00", "10.01"]);

		const tooBig = { down: "0", price: overMax, principal: overMax };
		expect(await errorOf(client, () => addQuote(client, tooBig))).toMatch(/domain amount/);
		expect(await errorOf(client, () => addQuote(client, { down: "-0.01", principal: "6000.01" }))).toMatch(
			/domain amount/,
		);
	});
});

test("principal must be price minus down payment and above 0", async () => {
	await inRolledBackTransaction(async (client) => {
		await actAs(client, users.ann);

		expect(await errorOf(client, () => addQuote(client, { principal: "4999.99" }))).toMatch(/quote_principal_check/);
		expect(await errorOf(client, () => addQuote(client, { down: "6000", principal: "0" }))).toMatch(
			/quote_principal_check/,
		);
	});
});

test("band is saved as a number from 0 to 99", async () => {
	await inRolledBackTransaction(async (client) => {
		await actAs(client, users.ann);
		const withBand = (band: number) =>
			client.query(
				`INSERT INTO quote (request_id, address, monthly_consumption_kwh, system_size_kw, down_payment, system_price, principal, band)
				 VALUES (gen_random_uuid(), '1 Main St', 500, 5, 0, 6000, 6000, $1) RETURNING band`,
				[band],
			);

		expect((await withBand(0)).rows[0].band).toBe(0);
		expect((await withBand(99)).rows[0].band).toBe(99);
		expect(await errorOf(client, () => withBand(100))).toMatch(/quote_band_check/);
		expect(await errorOf(client, () => withBand(-1))).toMatch(/quote_band_check/);
	});
});

test("a request id is unique per user, so two users never block each other", async () => {
	await inRolledBackTransaction(async (client) => {
		const withId = () =>
			client.query(
				`INSERT INTO quote (request_id, address, monthly_consumption_kwh, system_size_kw, down_payment, system_price, principal, band)
				 VALUES ('0199a1b2-0000-7000-8000-0000000000aa', '1 Main St', 500, 5, 0, 6000, 6000, 1)`,
			);

		await actAs(client, users.ann);
		await withId();
		expect(await errorOf(client, withId)).toMatch(/quote_request_id_key/);

		await actAs(client, users.bob);
		expect(await errorOf(client, withId)).toBeUndefined();
	});
});
