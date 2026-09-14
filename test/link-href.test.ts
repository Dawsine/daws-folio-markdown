import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBlockedLink, isExternalLink, splitLinkHref } from "../src/linkHref.ts";

describe("splitLinkHref", () => {
	it("keeps a relative markdown path", () => {
		assert.deepEqual(splitLinkHref("01-pipeline-summary-and-comparison.zh-CN.md"), {
			path: "01-pipeline-summary-and-comparison.zh-CN.md",
			hash: "",
		});
	});

	it("splits a parent path and hash", () => {
		assert.deepEqual(splitLinkHref("../plan/stage-1.9-comparison-contracts.zh-CN.md#sec"), {
			path: "../plan/stage-1.9-comparison-contracts.zh-CN.md",
			hash: "sec",
		});
	});

	it("treats a bare hash as same-document", () => {
		assert.deepEqual(splitLinkHref("#heading"), { path: "", hash: "heading" });
	});
});

describe("link kinds", () => {
	it("blocks script and data urls", () => {
		assert.equal(isBlockedLink("javascript:alert(1)"), true);
		assert.equal(isBlockedLink("data:text/html,hi"), true);
		assert.equal(isBlockedLink("01.md"), false);
	});

	it("marks http and mailto as external", () => {
		assert.equal(isExternalLink("https://example.com"), true);
		assert.equal(isExternalLink("mailto:a@b.c"), true);
		assert.equal(isExternalLink("../plan/a.md"), false);
	});
});
