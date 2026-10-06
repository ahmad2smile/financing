import { POST } from "./route";

const valid = {
  fullName: "Jane Doe",
  email: "jane@test.com",
  address: "1 Main St",
  monthlyConsumptionKwh: 500,
  systemSizeKw: 5,
  downPayment: 1000,
};

beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// Validation rules are tested in lib/quote.test.ts. These cover only the route's own branches.
it.each([
  [
    "valid input gives a quote",
    JSON.stringify(valid),
    200,
    expect.objectContaining({ systemPrice: 6000 }),
  ],
  [
    "bad JSON gives a request-level error",
    "{not json",
    400,
    { errors: { form: "Request body must be valid JSON." } },
  ],
  [
    "invalid input passes field errors through",
    JSON.stringify({ ...valid, fullName: "" }),
    422,
    { errors: { fullName: "Enter your full name." } },
  ],
])("%s", async (_, body, status, expected) => {
  const response = await POST(
    new Request("http://localhost/api/quotes", { method: "POST", body }),
  );

  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(expected);
  expect(console.warn).toHaveBeenCalledTimes(status === 200 ? 0 : 1);
});
