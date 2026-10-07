import { auth } from "@/lib/auth";
import { getQuote } from "@/data/quote-store";
import { logger } from "@/lib/log";

// One saved quote, for its owner or an admin. Row level security hides it from everyone else, so a quote that
// is missing, not yours, or has an id that is not a UUID all answer the same 404: nobody learns which quotes exist.
export async function GET(request: Request, ctx: RouteContext<"/api/quotes/[id]">) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) {
		logger.warn("rejected: not signed in");
		return Response.json({ errors: { form: "Sign in to see this quote." } }, { status: 401 });
	}

	const { id } = await ctx.params;
	const quote = await getQuote(session.user.id, id);
	if (!quote) {
		logger.info({ userId: session.user.id, quoteId: id }, "quote not found or not readable");
		return Response.json({ errors: { form: "Quote not found." } }, { status: 404 });
	}

	return Response.json(quote);
}
