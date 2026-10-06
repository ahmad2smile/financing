import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// jose ships only as an ES module. next/jest reads this list to compile it for Jest too.
	transpilePackages: ["jose"],
};

export default nextConfig;
