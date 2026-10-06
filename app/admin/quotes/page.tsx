import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Quotes from "../../quotes/quotes";

export const metadata: Metadata = { title: "All quotes" };

export default async function AllQuotesPage({ searchParams }: PageProps<"/admin/quotes">) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) redirect(`/sign-in?${new URLSearchParams({ callbackUrl: "/admin/quotes" })}`);

	// Row level security would show a non-admin only their own quotes anyway, but this page is not for them
	if (session.user.role !== "admin") notFound();

	return <Quotes scope="admin" userId={session.user.id} searchParams={searchParams} />;
}
