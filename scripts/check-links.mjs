// Every url this repository hands a reader, asked for real.
//
// The explorer was published here as sasona.ai/explorer, which answers 404: that host is an older
// copy of the site and the explorer is served on another one. A link in a public repository is a
// promise to somebody who has no way of knowing it is stale, so no url ships from here unchecked.
//
//     node scripts/check-links.mjs
//
// Nothing is installed and nothing is signed. A page is fetched; a resource is asked for a price
// with an empty body, which is what it answers before any payment.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FILES = ["README.md", "package.json", "src/index.ts", "examples/buy.ts"];
let fails = 0;

function check(name, ok, detail = "") {
  console.log((ok ? "PASS " : "FAIL ") + name + (detail === "" ? "" : `  (${String(detail).slice(0, 160)})`));
  if (!ok) fails++;
}

const urls = new Set();
for (const f of FILES) {
  const text = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of text.matchAll(/https:\/\/[\w.-]*sasona\.ai[\w./-]*/g)) {
    urls.add(m[0].replace(/[.,)]+$/, ""));
  }
}
check("the repository hands out urls, and they were all collected", urls.size > 0, urls.size);

/** What this url is, and so what answering means for it - never a list written twice. */
function expected(u) {
  const { pathname } = new URL(u);
  if (pathname === "/x402/buy") return { method: "POST", ok: [400], says: "exists and refuses an empty call" };
  if (pathname.startsWith("/x402/")) return { method: "POST", ok: [402], says: "answers with a price" };
  return { method: "GET", ok: [200], says: "answers" };
}

for (const u of [...urls].sort()) {
  const e = expected(u);
  let status = 0;
  let body = "";
  try {
    const r = await fetch(u, {
      method: e.method,
      headers: e.method === "POST" ? { "content-type": "application/json" } : {},
      body: e.method === "POST" ? "{}" : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = r.status;
    body = (await r.text()).slice(0, 120);
  } catch (err) {
    body = String(err.message ?? err);
  }
  check(`${u} ${e.says}`, e.ok.includes(status), `${status} ${body.replace(/\s+/g, " ")}`);
}

console.log();
console.log(fails ? `FAILED: ${fails}` : "ALL PASS");
process.exit(fails ? 1 : 0);
