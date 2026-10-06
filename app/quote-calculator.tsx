"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import {
	formSchema,
	quoteResultSchema,
	type Quote,
	type QuoteFields,
	type QuoteFormValues,
	type QuoteOwner,
} from "@/lib/quote";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const label = "text-sm font-medium";
const input =
	"h-10 rounded-[10px] border border-zinc-300 bg-black/[0.063] px-3 text-sm outline-none placeholder:text-zinc-500 focus:border-brand focus:bg-white aria-invalid:border-red-600 disabled:cursor-not-allowed disabled:text-zinc-500";
const errorText = "text-sm text-red-700";
const card = "rounded-xl border border-zinc-200 p-4";

const emptyForm: QuoteFormValues = {
	address: "",
	monthlyConsumptionKwh: "",
	systemSizeKw: "",
	downPayment: "",
};

const errorResponseSchema = z.object({ errors: z.record(z.string(), z.string()) });

// Name and email are shown from the session but not sent. The API reads them from the session too.
export default function QuoteCalculator({ owner }: { owner: QuoteOwner }) {
	const {
		register,
		handleSubmit,
		setError,
		formState: { errors, isSubmitting },
	} = useForm<QuoteFormValues, unknown, QuoteFields>({ resolver: zodResolver(formSchema), defaultValues: emptyForm });
	const [quote, setQuote] = useState<Quote | null>(null);
	const [stale, setStale] = useState(false);
	// Made once per page load. Request ids are UUID v5 of the inputs in this namespace: same inputs on the same page
	// give the same id, so a resubmit (like a retry after a network failure) saves nothing new. A reload gives new ids.
	const [namespace] = useState(() => crypto.randomUUID());

	// Root errors are cleared by react-hook-form on every submit
	const fail = (message: string) => setError("root.server", { message });

	async function onSubmit(fields: QuoteFields) {
		try {
			const response = await fetch("/api/quotes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...fields, requestId: uuidv5(JSON.stringify(fields), namespace) }),
			});
			const body: unknown = await response.json().catch(() => undefined);

			const result = quoteResultSchema.safeParse(body);
			if (response.ok && result.success) {
				setQuote(result.data);
				setStale(false);
				return;
			}

			setQuote(null);
			const rejected = errorResponseSchema.safeParse(body);
			if (!response.ok && rejected.success && Object.keys(rejected.data.errors).length > 0) {
				// Errors for unknown fields all go to the alert, so none are hidden.
				// hasOwn, not "in": every object also has keys like "constructor", and those are not form fields.
				const unknown: string[] = [];
				for (const [name, message] of Object.entries(rejected.data.errors)) {
					if (Object.hasOwn(emptyForm, name)) setError(name as keyof QuoteFormValues, { message });
					else unknown.push(message);
				}

				if (unknown.length) fail(unknown.join(" "));
				return;
			}

			console.error("Unexpected answer from /api/quotes", response.status, body);
			fail(`The server had a problem (status ${response.status}). Please try again.`);
		} catch (error) {
			console.error("Request to /api/quotes failed", error);
			setQuote(null);
			fail("Could not reach the server. Please try again.");
		}
	}

	return (
		<div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
			<form
				onSubmit={handleSubmit(onSubmit, () => setQuote(null))}
				onInput={() => quote && setStale(true)}
				noValidate
				className="grid gap-3"
				aria-label="Quote form"
			>
				{/* Locked while waiting: an edit then would make the answer look like it matches the new inputs */}
				<fieldset disabled={isSubmitting} className="grid min-w-0 gap-3">
					<div className="grid gap-1">
						<label htmlFor="fullName" className={label}>
							Full name
						</label>
						<input id="fullName" value={owner.fullName} disabled type="text" className={input} />
					</div>

					<div className="grid gap-1">
						<label htmlFor="email" className={label}>
							Email
						</label>
						<input id="email" value={owner.email} disabled type="email" className={input} />
					</div>

					<div className="grid gap-1">
						<label htmlFor="address" className={label}>
							Address
						</label>
						<input
							id="address"
							{...register("address")}
							type="text"
							autoComplete="street-address"
							aria-invalid={errors.address ? true : undefined}
							aria-describedby={errors.address ? "address-error" : undefined}
							className={input}
						/>
						{errors.address && (
							<p id="address-error" className={errorText}>
								{errors.address.message}
							</p>
						)}
					</div>

					{/* Number fields are text so we see exactly what was typed. type=number hides bad text as "". */}
					<div className="grid gap-1">
						<label htmlFor="monthlyConsumptionKwh" className={label}>
							Monthly consumption (kWh)
						</label>
						<input
							id="monthlyConsumptionKwh"
							{...register("monthlyConsumptionKwh")}
							type="text"
							inputMode="decimal"
							aria-invalid={errors.monthlyConsumptionKwh ? true : undefined}
							aria-describedby={errors.monthlyConsumptionKwh ? "monthlyConsumptionKwh-error" : undefined}
							className={input}
						/>
						{errors.monthlyConsumptionKwh && (
							<p id="monthlyConsumptionKwh-error" className={errorText}>
								{errors.monthlyConsumptionKwh.message}
							</p>
						)}
					</div>

					<div className="grid gap-1">
						<label htmlFor="systemSizeKw" className={label}>
							System size (kW)
						</label>
						<input
							id="systemSizeKw"
							{...register("systemSizeKw")}
							type="text"
							inputMode="decimal"
							aria-invalid={errors.systemSizeKw ? true : undefined}
							aria-describedby={errors.systemSizeKw ? "systemSizeKw-error" : undefined}
							className={input}
						/>
						{errors.systemSizeKw && (
							<p id="systemSizeKw-error" className={errorText}>
								{errors.systemSizeKw.message}
							</p>
						)}
					</div>

					<div className="grid gap-1">
						<label htmlFor="downPayment" className={label}>
							Down payment (USD, optional)
						</label>
						<input
							id="downPayment"
							{...register("downPayment")}
							type="text"
							inputMode="decimal"
							aria-invalid={errors.downPayment ? true : undefined}
							aria-describedby={errors.downPayment ? "downPayment-error" : undefined}
							className={input}
						/>
						{errors.downPayment && (
							<p id="downPayment-error" className={errorText}>
								{errors.downPayment.message}
							</p>
						)}
					</div>

					<button
						type="submit"
						className="mt-2 justify-self-center rounded-lg bg-brand px-8 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:bg-black/12.5"
					>
						{isSubmitting ? "Calculating..." : "Get pre-qualification"}
					</button>
				</fieldset>
				{errors.root?.server && (
					<p role="alert" className={`${errorText} text-center`}>
						{errors.root.server.message}
					</p>
				)}
			</form>

			<section
				aria-live="polite"
				aria-label="Quote results"
				className="border-t border-zinc-200 pt-8 md:border-t-0 md:border-l md:pt-0 md:pl-12"
			>
				{quote ? (
					<div className="grid gap-4">
						{stale && (
							<p role="status" className="font-medium text-amber-700">
								Inputs changed. These offers are out of date. Submit again to update them.
							</p>
						)}
						<div className={`grid gap-4 ${stale ? "opacity-50" : ""}`}>
							<dl className="grid grid-cols-2 gap-4">
								<div className={card}>
									<dt className="text-sm text-zinc-500">System price</dt>
									<dd className="text-2xl font-bold">{money.format(quote.systemPrice)}</dd>
								</div>
								<div className={card}>
									<dt className="text-sm text-zinc-500">Risk band</dt>
									<dd className="text-2xl font-bold">{quote.band}</dd>
								</div>
							</dl>

							<table className="w-full text-left">
								<caption className="pb-2 text-left text-lg font-bold">Installment offers</caption>
								<thead>
									<tr className="border-b border-zinc-300 text-sm text-zinc-500">
										<th scope="col" className="py-2">
											Term
										</th>
										<th scope="col">APR</th>
										<th scope="col" className="text-right">
											Monthly payment
										</th>
									</tr>
								</thead>
								<tbody>
									{quote.offers.map((offer) => (
										<tr key={offer.termYears} className="border-b border-zinc-200 text-sm">
											<th scope="row" className="py-2 font-normal">
												{offer.termYears} years
											</th>
											<td>{offer.apr}%</td>
											<td className="text-right font-semibold">{money.format(offer.monthlyPayment)}</td>
										</tr>
									))}
								</tbody>
							</table>
							<p className="text-sm text-zinc-500">Financed amount: {money.format(quote.offers[0].principalUsed)}</p>
						</div>
					</div>
				) : (
					<p className="text-center text-sm text-zinc-500">Fill in the form to see your offers.</p>
				)}
			</section>
		</div>
	);
}
