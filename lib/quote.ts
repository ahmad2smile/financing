import { z } from "zod";

export const bandSchema = z.enum(["A", "B", "C"]);

// From .env. NEXT_PUBLIC_ so the form's down payment check uses it too: it is fixed into both bundles at build time.
// Postgres reads the same value for its money limit (docker-compose.yml, docker/postgres/03-quotes.sql).
// Written out in full, not process.env[name], or Next can't fix it into the client bundle.
export const PRICE_PER_KW = z.coerce
	.number()
	.positive()
	.multipleOf(0.01)
	.parse(process.env.NEXT_PUBLIC_PRICE_PER_KW, {
		error: () => "NEXT_PUBLIC_PRICE_PER_KW must be a price above 0 with at most 2 decimals. Set it in .env",
	});
export const TERMS = [5, 10, 15];
export const APR_BY_BAND: Record<z.infer<typeof bandSchema>, number> = { A: 6.9, B: 8.9, C: 11.9 };

const offerSchema = z.object({
	termYears: z.number(),
	apr: z.number(),
	principalUsed: z.number(),
	monthlyPayment: z.number(),
});

// The client checks API answers with this before showing them
export const quoteResultSchema = z.object({
	systemPrice: z.number(),
	band: bandSchema,
	offers: z.array(offerSchema).length(TERMS.length),
});

export type Band = z.infer<typeof bandSchema>;
export type Quote = z.infer<typeof quoteResultSchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

// One price rule for both the down payment check and the quote
export const systemPrice = (systemSizeKw: number) => round2(systemSizeKw * PRICE_PER_KW);

// NOTE: Random limit for monthlyConsumptionKwh, based on biggest house being ~1000kWh. so just 100x
const kwhMessage = "Enter a number above 0 (max 100000), with at most 2 decimals.";
const kwMessage = "Enter a size from 1 to 1000 kW, with at most 2 decimals.";
const downMessage = "Enter 0 or more, with at most 2 decimals (cents).";

const numbers = {
	monthlyConsumptionKwh: z
		.number({ error: kwhMessage })
		.positive(kwhMessage)
		.max(100000, kwhMessage)
		.multipleOf(0.01, kwhMessage),
	systemSizeKw: z.number({ error: kwMessage }).min(1, kwMessage).max(1000, kwMessage).multipleOf(0.01, kwMessage),
	downPayment: z.number({ error: downMessage }).min(0, downMessage).multipleOf(0.01, downMessage),
};

// Name and email are not here: they come from the signed-in user, never from what the client sends
const address = z.string().trim().min(1, "Enter your address.").max(500, "Address is too long.");

// Runs only when both fields are valid, so an empty or bad size never blames the down payment.
// An empty path means the whole body is not an object.
const priceCheck = {
	path: ["downPayment"],
	error: "Down payment must be less than the system price.",
	when: (payload: z.core.ParsePayload) =>
		!payload.issues.some((i) => [undefined, "systemSizeKw", "downPayment"].includes(i.path?.[0] as string)),
};

// NOTE: How much downPayment, should be lower is a bussiness decision, i.e min limit of principal
const belowPrice = (q: { systemSizeKw: number; downPayment: number }) => q.downPayment < systemPrice(q.systemSizeKw);

// API: real JSON numbers only. A missing down payment means none. Unknown keys (fullName, email) are dropped.
// requestId: made by the client, the same on every retry of one quote, so a retry never saves it twice (data/quote-store.ts).
const apiSchema = z
	.object({
		requestId: z.uuid("Missing request id. Reload the page and try again."),
		address,
		...numbers,
		downPayment: numbers.downPayment.default(0),
	})
	.refine(belowPrice, priceCheck);

// Form (react-hook-form resolver): the exact text the user typed. Digits, optional thousands commas, optional decimals.
const DECIMAL_TEXT = /^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;
const fromText = (rule: z.ZodNumber, message: string) =>
	z
		.string({ error: message })
		.trim()
		.regex(DECIMAL_TEXT, message)
		.transform((text) => Number(text.replaceAll(",", "")))
		.pipe(rule);

export const formSchema = z
	.object({
		address,
		monthlyConsumptionKwh: fromText(numbers.monthlyConsumptionKwh, kwhMessage),
		systemSizeKw: fromText(numbers.systemSizeKw, kwMessage),
		// Empty means no down payment
		downPayment: z
			.string({ error: downMessage })
			.trim()
			.transform((text) => text || "0")
			.pipe(fromText(numbers.downPayment, downMessage)),
	})
	.refine(belowPrice, priceCheck);

// What the client sends, and who sends it (from the session)
export type QuoteBody = z.infer<typeof apiSchema>;
export type QuoteOwner = { fullName: string; email: string };
export type QuoteInput = QuoteBody & QuoteOwner;
export type QuoteFormValues = z.input<typeof formSchema>;
export type QuoteFields = z.output<typeof formSchema>;
// "form" holds errors that belong to the whole request, not one field
export type FieldErrors = Partial<Record<keyof QuoteBody | "form", string>>;

// The real check, at the API edge. The owner is the signed-in user, so a body can't quote for someone else.
export function validate(raw: unknown, owner: QuoteOwner): { input?: QuoteInput; errors: FieldErrors } {
	const result = apiSchema.safeParse(raw);
	if (result.success) return { input: { ...result.data, fullName: owner.fullName, email: owner.email }, errors: {} };

	const { formErrors, fieldErrors } = z.flattenError(result.error);
	const errors: FieldErrors = {};
	for (const [field, messages] of Object.entries(fieldErrors)) errors[field as keyof QuoteBody] = messages?.[0];
	if (formErrors[0]) errors.form = formErrors[0];

	return { errors };
}

// NOTE: systemSizeKw wasn't cleared, made assumption as to higher size requested mean larger principal == Good Rate
export function riskBand(monthlyConsumptionKwh: number, systemSizeKw: number): Band {
	if (monthlyConsumptionKwh >= 400 && systemSizeKw >= 6) return "A";
	if (monthlyConsumptionKwh >= 250) return "B";
	return "C";
}

// Standard amortization: P * r / (1 - (1 + r)^-n), monthly rate r, n payments
export function monthlyPayment(principal: number, aprPercent: number, termYears: number) {
	const r = aprPercent / 100 / 12;
	const n = termYears * 12;

	return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

export function computeQuote(input: QuoteFields): Quote {
	const price = systemPrice(input.systemSizeKw);
	const principalUsed = round2(price - input.downPayment);
	const band = riskBand(input.monthlyConsumptionKwh, input.systemSizeKw);
	const apr = APR_BY_BAND[band];

	return {
		systemPrice: price,
		band,
		offers: TERMS.map((termYears) => ({
			termYears,
			apr,
			principalUsed,
			monthlyPayment: monthlyPayment(principalUsed, apr, termYears),
		})),
	};
}
