"use client";

import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });

// Replaces Next's default error page for any page error, like Postgres being down.
// It replaces the root layout too, so it needs its own <html>, <body>, styles and font.
// Next sends it with status 500. The real error is in the server log, matched by `digest`.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
	return (
		<html lang="en" className={`${dmSans.variable} antialiased`}>
			<body className="flex min-h-dvh flex-col font-sans">
				<title>Service unavailable</title>
				<main className="flex flex-1 items-center justify-center px-4 py-6">
					<div className="w-full max-w-xl rounded-3xl bg-white px-6 py-10 text-center shadow-2xl shadow-black/20 sm:px-8">
						<h1 className="text-[26px] font-bold">Service unavailable</h1>
						<p className="mt-2 text-sm leading-relaxed">
							Something went wrong on our side. Please try again in a moment.
						</p>
						{error.digest && <p className="mt-2 text-xs text-zinc-500">Error code: {error.digest}</p>}

						<button
							onClick={() => retry()}
							className="bg-brand hover:bg-brand-dark mt-6 rounded-full px-6 py-3 font-semibold text-white shadow"
						>
							Try again
						</button>
					</div>
				</main>
			</body>
		</html>
	);
}
