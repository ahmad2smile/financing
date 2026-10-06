import { auth } from "@/lib/auth";
import { POST } from "./route";

// The real auth module needs Postgres and Keycloak. E2E tests cover that path.
jest.mock("@/lib/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
const getSession = jest.mocked(auth.api.getSession as () => Promise<unknown>);
const signedIn = { user: { id: "1", name: "Jane Doe", email: "jane@test.com" }, session: { id: "s1" } };

const valid = {
	address: "1 Main St",
	monthlyConsumptionKwh: 500,
	systemSizeKw: 5,
	downPayment: 1000,
};

beforeEach(() => {
	jest.spyOn(console, "warn").mockImplementation(() => {});
	getSession.mockResolvedValue(signedIn);
});
afterEach(() => jest.restoreAllMocks());

// Validation rules are tested in lib/quote.test.ts. These cover only the route's own branches.
it.each([
	["valid input gives a quote", JSON.stringify(valid), 200, expect.objectContaining({ systemPrice: 6000 })],
	["bad JSON gives a request-level error", "{not json", 400, { errors: { form: "Request body must be valid JSON." } }],
	[
		"invalid input passes field errors through",
		JSON.stringify({ ...valid, address: "" }),
		422,
		{ errors: { address: "Enter your address." } },
	],
	[
		"name and email in the body are ignored, the session has them",
		JSON.stringify({ ...valid, fullName: "", email: "not an email" }),
		200,
		expect.objectContaining({ systemPrice: 6000 }),
	],
])("%s", async (_, body, status, expected) => {
	const response = await POST(new Request("http://localhost/api/quotes", { method: "POST", body }));

	expect(response.status).toBe(status);
	expect(await response.json()).toEqual(expected);
	expect(console.warn).toHaveBeenCalledTimes(status === 200 ? 0 : 1);
});

it("signed out gives 401 and does not compute a quote", async () => {
	getSession.mockResolvedValue(null);

	const response = await POST(
		new Request("http://localhost/api/quotes", { method: "POST", body: JSON.stringify(valid) }),
	);

	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({ errors: { form: "Sign in to get a quote." } });
	expect(console.warn).toHaveBeenCalledTimes(1);
});
