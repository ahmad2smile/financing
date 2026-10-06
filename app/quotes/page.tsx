import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Quotes from "./quotes";

export const metadata: Metadata = { title: "My quotes" };

export default async function MyQuotesPage({ searchParams }: PageProps<"/quotes">) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) redirect(`/sign-in?${new URLSearchParams({ callbackUrl: "/quotes" })}`);

	return <Quotes scope="user" userId={session.user.id} searchParams={searchParams} />;
}
