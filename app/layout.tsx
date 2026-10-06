import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import AuthBar from "./auth-bar";
import "./globals.css";

const dmSans = DM_Sans({
	variable: "--font-dm-sans",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Solar financing calculator",
	description: "Get a solar system price, risk band and installment offers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en" className={`${dmSans.variable} antialiased`}>
			<body className="flex min-h-dvh flex-col font-sans">
				<AuthBar />
				{children}
			</body>
		</html>
	);
}
