import type { Instrumentation } from "next";
import { registerOTel } from "@vercel/otel";
import { logger } from "./lib/log";

// Runs once when the server starts, before it takes requests
export async function register() {
	// Next.js makes a span for every request, with method, route, status and duration. Log lines take its trace id (lib/log.ts).
	// The spans are sent to an OpenTelemetry collector when OTEL_EXPORTER_OTLP_ENDPOINT is set.
	registerOTel({ serviceName: "financing" });

	if (process.env.NEXT_RUNTIME === "nodejs") {
		// Opening one connection runs the role check in data/db.ts. An unsafe role means refuse to run.
		// An unreachable database only gets logged: the same check still runs on every later connection.
		const { db, UnsafeRoleError } = await import("./data/db");
		try {
			(await db.connect()).release();
		} catch (error) {
			if (error instanceof UnsafeRoleError) {
				logger.error({ err: error }, "refusing to start");
				process.exit(1);
			}
			logger.error(
				{ err: error },
				"startup database role check could not connect, it runs again on every new connection",
			);
		}
	}
}

// Errors no handler caught, in pages and routes
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
	logger.error(
		{
			method: request.method,
			path: request.path.split("?")[0],
			route: context.routePath,
			routeType: context.routeType,
			err: error,
		},
		"unhandled error",
	);
};
