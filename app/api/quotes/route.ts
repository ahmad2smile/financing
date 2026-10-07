import { DatabaseError } from "pg";
import { auth } from "@/lib/auth";
import { computeQuote, validate } from "@/lib/quote";
import { saveQuote } from "@/data/quote-store";
import { logger } from "@/lib/log";

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) {
		logger.warn("rejected: not signed in");
		return Response.json({ errors: { form: "Sign in to get a quote." } }, { status: 401 });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch (error) {
		logger.warn({ err: error }, "rejected: body is not valid JSON");
		return Response.json({ errors: { form: "Request body must be valid JSON." } }, { status: 400 });
	}

	// Name and email come from the session. Whatever the body says about them is ignored.
	const { input, errors } = validate(raw, { fullName: session.user.name, email: session.user.email });
	if (!input) {
		logger.warn({ errors }, "rejected: invalid input");
		return Response.json({ errors }, { status: 422 });
	}

	// The user still gets their offers if saving fails for a temporary reason. The failure is logged with the full quote so it can be recovered.
	// Data Postgres refuses (class 22, or a check) fails the same on every retry, so it is bad input: answer 422, not a quote that is never saved.
	const quote = computeQuote(input);
	try {
		await saveQuote(session.user.id, input, quote);
	} catch (error) {
		if (error instanceof DatabaseError && (error.code?.startsWith("22") || error.code === "23514")) {
			logger.warn({ input, quote, err: error }, "rejected: Postgres refused the data");
			return Response.json(
				{ errors: { form: "These details can't be saved. Check them and try again." } },
				{ status: 422 },
			);
		}

		logger.error({ userId: session.user.id, input, quote, err: error }, "could not save the quote");
	}

	return Response.json(quote);
}
