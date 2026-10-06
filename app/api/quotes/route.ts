import { DatabaseError } from "pg";
import { auth } from "@/lib/auth";
import { computeQuote, validate } from "@/lib/quote";
import { saveQuote } from "@/data/quote-store";

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) {
		console.warn("POST /api/quotes rejected: not signed in");
		return Response.json({ errors: { form: "Sign in to get a quote." } }, { status: 401 });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch (error) {
		console.warn("POST /api/quotes rejected: body is not valid JSON", error);
		return Response.json({ errors: { form: "Request body must be valid JSON." } }, { status: 400 });
	}

	// Name and email come from the session. Whatever the body says about them is ignored.
	const { input, errors } = validate(raw, { fullName: session.user.name, email: session.user.email });
	if (!input) {
		console.warn("POST /api/quotes rejected: invalid input", errors);
		return Response.json({ errors }, { status: 422 });
	}

	// The user still gets their offers if saving fails for a temporary reason. The failure is logged with the full quote so it can be recovered.
	// Data Postgres refuses (class 22, or a check) fails the same on every retry, so it is bad input: answer 422, not a quote that is never saved.
	const quote = computeQuote(input);
	try {
		await saveQuote(session.user.id, input, quote);
	} catch (error) {
		if (error instanceof DatabaseError && (error.code?.startsWith("22") || error.code === "23514")) {
			console.warn("POST /api/quotes rejected: Postgres refused the data", { input, quote }, error);
			return Response.json(
				{ errors: { form: "These details can't be saved. Check them and try again." } },
				{ status: 422 },
			);
		}

		console.error(`POST /api/quotes could not save the quote of user ${session.user.id}`, { input, quote }, error);
	}

	return Response.json(quote);
}
