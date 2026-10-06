import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
	testEnvironment: "node",
	testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
});
