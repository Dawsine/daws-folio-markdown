export type SplitHref = { path: string; hash: string };

export function splitLinkHref(href: string): SplitHref {
	const trimmed = String(href ?? "").trim();
	const hashAt = trimmed.indexOf("#");
	if (hashAt < 0) {
		return { path: trimmed, hash: "" };
	}
	return { path: trimmed.slice(0, hashAt), hash: trimmed.slice(hashAt + 1) };
}

export function isBlockedLink(href: string): boolean {
	return /^(javascript|vbscript|data):/i.test(String(href ?? "").trim());
}

export function isExternalLink(href: string): boolean {
	return /^(https?:|mailto:)/i.test(String(href ?? "").trim());
}
