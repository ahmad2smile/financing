import { DatabaseError } from "pg";
import { auth } from "@/lib/auth";
import { saveQuote } from "@/data/quote-store";
import { logger } from "@/lib/log";
import { POST } from "./route";

// Auth and store need Keycloak and Postgres, so they are mocked. E2E tests cover the real path.
jest.mock("@/lib/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/data/quote-store", () => ({ saveQuote: jest.fn() }));
const getSession = jest.mocked(auth.api.getSession as () => Promise<unknown>);
const save = jest.mocked(saveQuote);

const valid = {
	requestId: "0199a1b2-0000-7000-8000-000000000001",
	address: "1 Main St",
	monthlyConsumptionKwh: 500,
	systemSizeKw: 5,
	downPayment: 1000,
};

const post = (body: string) => POST(new Request("http://localhost/api/quotes", { method: "POST", body }));

beforeEach(() => {
	jest.clearAllMocks();
	jest.spyOn(logger, "warn").mockImplementation(() => {});
	jest.spyOn(logger, "error").mockImplementation(() => {});
	getSession.mockResolvedValue({ user: { id: "1", name: "Jane Doe", email: "jane@test.com" } });
	save.mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

it("signed out gives 401", async () => {
	getSession.mockResolvedValue(null);

	const response = await post(JSON.stringify(valid));

	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ errors: { form: "Sign in to get a quote." } });
	expect(save).not.toHaveBeenCalled();
});

it("body that is not JSON gives 400", async () => {
	const response = await post("{not json");

	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ errors: { form: "Request body must be valid JSON." } });
	expect(save).not.toHaveBeenCalled();
});

it("invalid input gives 422 with field errors", async () => {
	const response = await post(JSON.stringify({ ...valid, address: "" }));

	expect(response.status).toBe(422);
	expect(await response.json()).toEqual({ errors: { address: "Enter your address." } });
	expect(save).not.toHaveBeenCalled();
});

it("valid input is answered with the quote and saved for the session user", async () => {
	const response = await post(JSON.stringify(valid));

	expect(response.status).toBe(200);
	const quote = await response.json();
	expect(quote).toMatchObject({ systemPrice: 6000, band: "B" });
	expect(save).toHaveBeenCalledWith("1", expect.objectContaining(valid), quote);
});

it("save failure still answers with the computed quote and logs it", async () => {
	save.mockRejectedValue(new Error("connection refused"));

	const response = await post(JSON.stringify(valid));

	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ systemPrice: 6000, band: "B" });
	// Logged once, with what is needed to find and recover the quote
	expect(logger.error).toHaveBeenCalledTimes(1);
	expect(logger.error).toHaveBeenCalledWith(
		expect.objectContaining({
			userId: "1",
			input: expect.objectContaining(valid),
			err: expect.objectContaining({ message: "connection refused" }),
		}),
		"could not save the quote",
	);
});

// Same error pg throws for data Postgres refuses: 22021 is a NUL byte in text, 23514 a failed check
const refused = (code: string) => Object.assign(new DatabaseError("refused", 0, "error"), { code });

it.each(["22021", "23514"])(
	"save refused by Postgres as bad data (%s) gives 422, not a quote that was never saved",
	async (code) => {
		save.mockRejectedValue(refused(code));

		const response = await post(JSON.stringify(valid));

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			errors: { form: "These details can't be saved. Check them and try again." },
		});
		expect(logger.warn).toHaveBeenCalledTimes(1);
	},
);

it("save failing for another Postgres reason still answers with the quote", async () => {
	save.mockRejectedValue(refused("57P01"));

	const response = await post(JSON.stringify(valid));

	expect(response.status).toBe(200);
	expect(logger.error).toHaveBeenCalledTimes(1);
});
