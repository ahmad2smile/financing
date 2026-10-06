import { z } from "zod";

export const bandSchema = z.enum(["A", "B", "C"]);

export const PRICE_PER_KW = 1200;
export const TERMS = [5, 10, 15];
export const APR_BY_BAND: Record<z.infer<typeof bandSchema>, number> = {
  A: 6.9,
  B: 8.9,
  C: 11.9,
};

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
export const systemPrice = (systemSizeKw: number) =>
  round2(systemSizeKw * PRICE_PER_KW);

// NOTE: Random limit for monthlyConsumptionKwh, based on biggest house being ~1000kWh. so just 100x
const kwhMessage = "Enter a number above 0 (max 100000).";
const kwMessage = "Enter a size from 1 to 1000 kW, with at most 2 decimals.";
const downMessage = "Enter 0 or more, with at most 2 decimals (cents).";

const numbers = {
  monthlyConsumptionKwh: z
    .number({ error: kwhMessage })
    .positive(kwhMessage)
    .max(100000, kwhMessage),
  systemSizeKw: z
    .number({ error: kwMessage })
    .min(1, kwMessage)
    .max(1000, kwMessage)
    .multipleOf(0.01, kwMessage),
  downPayment: z
    .number({ error: downMessage })
    .min(0, downMessage)
    .multipleOf(0.01, downMessage),
};

const person = {
  fullName: z
    .string()
    .trim()
    .min(1, "Enter your full name.")
    .max(200, "Name is too long."),
  email: z
    .string()
    .trim()
    .max(254, "Enter a valid email address.")
    .pipe(z.email("Enter a valid email address.")),
  address: z
    .string()
    .trim()
    .min(1, "Enter your address.")
    .max(500, "Address is too long."),
};

// Runs only when both fields are valid, so an empty or bad size never blames the down payment.
// An empty path means the whole body is not an object.
const priceCheck = {
  path: ["downPayment"],
  error: "Down payment must be less than the system price.",
  when: (payload: z.core.ParsePayload) =>
    !payload.issues.some((i) =>
      [undefined, "systemSizeKw", "downPayment"].includes(
        i.path?.[0] as string,
      ),
    ),
};

// NOTE: How much downPayment, should be lower is a bussiness decision, i.e min limit of principal
const belowPrice = (q: { systemSizeKw: number; downPayment: number }) =>
  q.downPayment < systemPrice(q.systemSizeKw);

// API: real JSON numbers only. A missing down payment means none.
const apiSchema = z
  .object({
    ...person,
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
    ...person,
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

export type QuoteInput = z.infer<typeof apiSchema>;
export type QuoteFormValues = z.input<typeof formSchema>;
// "form" holds errors that belong to the whole request, not one field
export type FieldErrors = Partial<Record<keyof QuoteInput | "form", string>>;

// The real check, at the API edge
export function validate(raw: unknown): {
  input?: QuoteInput;
  errors: FieldErrors;
} {
  const result = apiSchema.safeParse(raw);
  if (result.success) return { input: result.data, errors: {} };

  const { formErrors, fieldErrors } = z.flattenError(result.error);
  const errors: FieldErrors = {};
  for (const [field, messages] of Object.entries(fieldErrors))
    errors[field as keyof QuoteInput] = messages?.[0];
  if (formErrors[0]) errors.form = formErrors[0];

  return { errors };
}

// NOTE: systemSizeKw wasn't cleared, made assumption as to higher size requested mean larger principal == Good Rate
export function riskBand(
  monthlyConsumptionKwh: number,
  systemSizeKw: number,
): Band {
  if (monthlyConsumptionKwh >= 400 && systemSizeKw >= 6) return "A";
  if (monthlyConsumptionKwh >= 250) return "B";
  return "C";
}

// Standard amortization: P * r / (1 - (1 + r)^-n), monthly rate r, n payments
export function monthlyPayment(
  principal: number,
  aprPercent: number,
  termYears: number,
) {
  const r = aprPercent / 100 / 12;
  const n = termYears * 12;

  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

export function computeQuote(input: QuoteInput): Quote {
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
