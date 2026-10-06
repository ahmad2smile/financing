import { computeQuote, validate } from "@/lib/quote";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (error) {
    console.warn("POST /api/quotes rejected: body is not valid JSON", error);
    return Response.json(
      { errors: { form: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const { input, errors } = validate(raw);
  if (!input) {
    console.warn("POST /api/quotes rejected: invalid input", errors);
    return Response.json({ errors }, { status: 422 });
  }

  return Response.json(computeQuote(input));
}
