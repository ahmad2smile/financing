import { trace } from "@opentelemetry/api";
import pino from "pino";

// One JSON line per event on stdout. Put an error under `err` to get its type, message, stack, cause and own fields.
// Every line written in a request has the traceId and spanId of the current span, made by Next.js (instrumentation.ts).
export const logger = pino({
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: { level: (label) => ({ level: label }) },
	mixin: () => {
		const span = trace.getActiveSpan()?.spanContext();
		return span ? { traceId: span.traceId, spanId: span.spanId } : {};
	},
});
