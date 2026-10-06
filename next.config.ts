import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Copies only the files the server needs into .next/standalone, with its own server.js. The Dockerfile runs that.
	output: "standalone",
	// jose ships only as an ES module. next/jest reads this list to compile it for Jest too.
	transpilePackages: ["jose"],
};

export default nextConfig;
