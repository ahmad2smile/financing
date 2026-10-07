"use client";

import { useSyncExternalStore } from "react";

// No timeZone: the browser's own, so only used in the browser
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const noSubscribe = () => () => {};

// The server renders this first and does not know the viewer's time zone, so it shows no text until the browser
// takes over. useSyncExternalStore gives false on the server and while hydrating, then true, so there is no mismatch.
export default function LocalTime({ value }: { value: Date }) {
	const inBrowser = useSyncExternalStore(
		noSubscribe,
		() => true,
		() => false,
	);

	return <time dateTime={value.toISOString()}>{inBrowser ? date.format(value) : null}</time>;
}
