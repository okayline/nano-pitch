import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../public/version.js";

test("the page's version matches the newest CHANGELOG.md entry", () => {
  const top = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").match(/^## (v[\d.]+)/m)[1];
  assert.equal(VERSION, top);
});

test("the shared footer on the page shows that version", () => {
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(page.includes("/footer.js") && page.includes(`data-version="${VERSION}"`));
});
