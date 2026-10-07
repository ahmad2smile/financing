import { auth } from "@/lib/auth";
import { getQuote, type SavedQuote } from "@/data/quote-store";
import { logger } from "@/lib/log";
import { GET } from "./route";

// Auth and store need Keycloak and Postgres, so they are mocked. E2E tests cover the real path and row level security.
jest.mock("@/lib/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/data/quote-store", () => ({ getQuote: jest.fn() }));
const getSession = jest.mocked(auth.api.getSession as () => Promise<unknown>);
const read = jest.mocked(getQuote);

const id = "0199a1b2-0000-7000-8000-000000000001";

const saved: SavedQuote = {
	id,
	createdAt: new Date("2026-10-06T19:35:20Z"),
	ownerEmail: "jane@test.com",
	address: "1 Main St",
	monthlyConsumptionKwh: 500,
	systemSizeKw: 5,
	downPayment: 1000,
	systemPrice: 6000,
	principal: 5000,
	band: "B",
	offers: [{ termYears: 5, apr: 8.9, monthlyPayment: 103.55 }],
};

const get = (quoteId: string) =>
	GET(new Request(`http://localhost/api/quotes/${quoteId}`), { params: Promise.resolve({ id: quoteId }) });

beforeEach(() => {
	jest.clearAllMocks();
	jest.spyOn(logger, "warn").mockImplementation(() => {});
	jest.spyOn(logger, "info").mockImplementation(() => {});
	getSession.mockResolvedValue({ user: { id: "1", name: "Jane Doe", email: "jane@test.com" } });
	read.mockResolvedValue(saved);
});
afterEach(() => jest.restoreAllMocks());

it("signed out gives 401 and reads nothing", async () => {
	getSession.mockResolvedValue(null);

	const response = await get(id);

	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ errors: { form: "Sign in to see this quote." } });
	expect(read).not.toHaveBeenCalled();
});

it("a readable quote is answered as the session user", async () => {
	const response = await get(id);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ...saved, createdAt: "2026-10-06T19:35:20.000Z" });
	expect(read).toHaveBeenCalledWith("1", id);
});

it("a quote that is missing or not yours gives 404", async () => {
	read.mockResolvedValue(null);

	const response = await get(id);

	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ errors: { form: "Quote not found." } });
});
