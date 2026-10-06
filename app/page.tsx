import Link from "next/link";

export default function Home() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 py-6">
			<div className="w-full max-w-xl rounded-3xl bg-white px-6 py-10 text-center shadow-2xl shadow-black/20 sm:px-8">
				<h1 className="text-[26px] font-bold">Finance your solar system</h1>
				<p className="mt-2 text-sm leading-relaxed">
					Get a system price, a risk band and three installment offers made for you.
				</p>

				{/* /quotes sends signed-out users to sign in first */}
				<Link
					href="/quotes"
					className="bg-brand hover:bg-brand-dark mt-6 inline-block rounded-full px-6 py-3 font-semibold text-white shadow"
				>
					Get personal quote
				</Link>
			</div>
		</main>
	);
}
