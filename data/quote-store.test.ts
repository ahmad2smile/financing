import { bandSchema } from "@/lib/quote";
import { BAND_CODE } from "./quote-store";

// The pool is never used here, so no database is needed
jest.mock("./db", () => ({ db: {} }));

it("every band has its own number in the range the database allows", () => {
	const codes = bandSchema.options.map((band) => BAND_CODE[band]);

	expect(codes).toEqual([0, 1, 2]);
	expect(new Set(codes).size).toBe(codes.length);
	expect(codes.every((code) => Number.isInteger(code) && code >= 0 && code <= 99)).toBe(true);
});
