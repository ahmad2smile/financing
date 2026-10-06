import QuoteCalculator from "./quote-calculator";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-6">
      <div className="w-full max-w-5xl rounded-3xl bg-white px-6 pb-8 shadow-2xl shadow-black/20 sm:px-8">
        <div className="mx-auto max-w-xl pt-8 text-center">
          <h1 className="text-[26px] font-bold">
            Calculate your financing options!
          </h1>
          <p className="mt-2 text-sm leading-relaxed">
            Enter your details to get a system price, a risk band and three
            installment offers.
          </p>
        </div>

        <QuoteCalculator />
      </div>
    </main>
  );
}
