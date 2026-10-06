import nextJest from "next/jest.js";

// Unit tests expect prices at 1200 per kW, whatever .env says. next/jest does not override a value already set.
process.env.NEXT_PUBLIC_PRICE_PER_KW = "1200";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
	testEnvironment: "node",
	testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
});
