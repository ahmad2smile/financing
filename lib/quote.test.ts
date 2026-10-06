import { z } from "zod";
import { computeQuote, formSchema, monthlyPayment, riskBand, validate } from "./quote";

// Same parse the react-hook-form resolver runs. The form shows the first message per field.
function validateForm(raw: unknown) {
	const result = formSchema.safeParse(raw);
	const fieldErrors = result.success ? {} : z.flattenError(result.error).fieldErrors;
	const errors = Object.fromEntries(Object.entries(fieldErrors).map(([field, messages]) => [field, messages?.[0]]));

	return { input: result.data, errors };
}

const form = {
	address: "1 Main St",
	monthlyConsumptionKwh: "500",
	systemSizeKw: "5",
	downPayment: "",
};

const api = {
	...form,
	requestId: "0199a1b2-0000-7000-8000-000000000001",
	monthlyConsumptionKwh: 500,
	systemSizeKw: 5,
	downPayment: 0,
};
const owner = { fullName: "Jane Doe", email: "jane@test.com" };

it("risk bands", () => {
	expect(riskBand(400, 6)).toBe("A");
	expect(riskBand(400, 5.99)).toBe("B");
	expect(riskBand(250, 10)).toBe("B");
	expect(riskBand(249, 1)).toBe("C");
});

it("monthly payment uses amortization", () => {
	expect(monthlyPayment(10000, 6.9, 5)).toBe(197.54);
});

it("quote price, principal and offers", () => {
	// Typed text with spaces, thousands commas and cents
	const { input } = validateForm({ ...form, monthlyConsumptionKwh: " 1,200 ", downPayment: "1,000.50" });
	const quote = computeQuote(input!);

	expect(input?.monthlyConsumptionKwh).toBe(1200);
	expect(quote.systemPrice).toBe(6000);
	expect(quote.band).toBe("B");
	expect(quote.offers.map((o) => o.termYears)).toEqual([5, 10, 15]);
	expect(quote.offers.every((o) => o.principalUsed === 4999.5 && o.apr === 8.9)).toBe(true);
});

const kwhErr = "Enter a number above 0 (max 100000), with at most 2 decimals.";
const kwErr = "Enter a size from 1 to 1000 kW, with at most 2 decimals.";
const downPaymentErr = "Enter 0 or more, with at most 2 decimals (cents).";
const belowPriceErr = "Down payment must be less than the system price.";

type Row = [name: string, overrides: Record<string, string>, expected: Record<string, string>];

it.each<Row>([
	["valid form", {}, {}],
	["empty down payment means none", { downPayment: "" }, {}],
	["thousands commas and spaces", { monthlyConsumptionKwh: " 1,200 ", downPayment: "1,234.56" }, {}],
	["required address", { address: " " }, { address: "Enter your address." }],
	["zero kWh", { monthlyConsumptionKwh: "0" }, { monthlyConsumptionKwh: kwhErr }],
	["kWh above max", { monthlyConsumptionKwh: "100001" }, { monthlyConsumptionKwh: kwhErr }],
	["kWh with 2 decimals", { monthlyConsumptionKwh: "0.01" }, {}],
	["kWh with 3 decimals", { monthlyConsumptionKwh: "500.125" }, { monthlyConsumptionKwh: kwhErr }],
	["size below 1 kW", { systemSizeKw: "0.99" }, { systemSizeKw: kwErr }],
	["size at 1 kW", { systemSizeKw: "1" }, {}],
	["size with 3 decimals", { systemSizeKw: "1.555" }, { systemSizeKw: kwErr }],
	["negative down payment", { downPayment: "-5" }, { downPayment: downPaymentErr }],
	["down payment with fractions of a cent", { downPayment: "5999.999" }, { downPayment: downPaymentErr }],
	["down payment with comma in the wrong place", { downPayment: "5,00" }, { downPayment: downPaymentErr }],
	["down payment in exponent form", { downPayment: "5e3" }, { downPayment: downPaymentErr }],
	["down payment in hex", { downPayment: "0x10" }, { downPayment: downPaymentErr }],
	["down payment with two dots", { downPayment: "1.2.3" }, { downPayment: downPaymentErr }],
	["down payment as letters", { downPayment: "abc" }, { downPayment: downPaymentErr }],
	["down payment with a space inside", { downPayment: "5 000" }, { downPayment: downPaymentErr }],
	["down payment with a trailing comma", { downPayment: ".5," }, { downPayment: downPaymentErr }],
	["down payment equal to price", { downPayment: "6000" }, { downPayment: belowPriceErr }],
	["down payment one cent below price", { downPayment: "5999.99" }, {}],
	["blank size does not blame the empty down payment", { systemSizeKw: "" }, { systemSizeKw: kwErr }],
	[
		"bad size does not blame a high down payment",
		{ systemSizeKw: "-1", downPayment: "99999" },
		{ systemSizeKw: kwErr },
	],
])("form: %s", (_, overrides, expected) => {
	expect(validateForm({ ...form, ...overrides }).errors).toEqual(expected);
});

it("down payment check uses the same rounded price as the quote", () => {
	// 2.22 * 1200 is 2664.0000000000005 in floats, the quote price is 2664
	expect(validate({ ...api, systemSizeKw: 2.22, downPayment: 2664 }, owner).errors.downPayment).toBeTruthy();
	expect(
		computeQuote(validate({ ...api, systemSizeKw: 2.22, downPayment: 2663.99 }, owner).input!).offers[0].principalUsed,
	).toBe(0.01);
});

it("API refuses kWh with more than 2 decimals, so the database never rounds it", () => {
	expect(validate({ ...api, monthlyConsumptionKwh: 500.125 }, owner).errors).toEqual({ monthlyConsumptionKwh: kwhErr });
	expect(validate({ ...api, monthlyConsumptionKwh: 500.12 }, owner).errors).toEqual({});
});

it("name and email come from the owner, not the body", () => {
	const { input, errors } = validate({ ...api, fullName: "Someone Else", email: "other@test.com" }, owner);

	expect(errors).toEqual({});
	expect(input).toMatchObject(owner);
});

it("API needs a request id, so a retry can be matched to the quote it repeats", () => {
	const withoutId = { ...api, requestId: undefined };
	const idErr = "Missing request id. Reload the page and try again.";

	expect(validate(withoutId, owner).errors).toEqual({ requestId: idErr });
	expect(validate({ ...api, requestId: "not-a-uuid" }, owner).errors).toEqual({ requestId: idErr });
	expect(validate(api, owner).input?.requestId).toBe(api.requestId);
});

it.each([undefined, "", "abc", "0", "-5", "12.345"])("refuses to load with price per kW %p", async (price) => {
	const saved = process.env.NEXT_PUBLIC_PRICE_PER_KW;
	if (price === undefined) delete process.env.NEXT_PUBLIC_PRICE_PER_KW;
	else process.env.NEXT_PUBLIC_PRICE_PER_KW = price;

	try {
		await expect(jest.isolateModulesAsync(() => import("./quote"))).rejects.toThrow(
			/NEXT_PUBLIC_PRICE_PER_KW must be a price/,
		);
	} finally {
		process.env.NEXT_PUBLIC_PRICE_PER_KW = saved;
	}
});
