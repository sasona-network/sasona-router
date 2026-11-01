// Every url and every resource this repository hands a reader, asked for real.
//
//     node scripts/check-links.mjs
//
// The explorer was once published here as sasona.ai/explorer, which answers 404: that host is an
// older copy of the site. A link in a public repository is a promise to somebody who has no way of
// knowing it is stale, so nothing ships from here unasked.
//
// It reads EVERY file in the repository, not a list of four - a file left off that list is a file
// whose links nobody checks - and it asks for the resource rows in the README table too, which are
// written host-less (`POST /x402/run-code`) and so were invisible to a plain url match. A renamed
// resource used to ship a dead table row under a green check.
//
// Nothing is signed and nothing is spent: a page is fetched, and a resource is asked for a price
// with an empty body, which is what it answers before any payment.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ROUTER = "https://router.sasona.ai";
const SKIP = new Set(["node_modules", ".git", "dist"]);
let fails = 0;

function check(name, ok, detail = "") {
  console.log((ok ? "PASS " : "FAIL ") + name + (detail === "" ? "" : `  (${String(detail).slice(0, 160)})`));
  if (!ok) fails++;
}

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(md|ts|mjs|js|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

const urls = new Set();
for (const f of files(root)) {
  const text = fs.readFileSync(f, "utf8");
  // ours, and the repository's own page. example.com is deliberately not a real seller.
  for (const m of text.matchAll(/https:\/\/(?:[\w-]+\.)*sasona\.ai[\w./-]*|https:\/\/github\.com\/sasona-network[\w./-]*/g)) {
    urls.add(m[0].replace(/[.,)]+$/, ""));
  }
  // and every resource the README names, host-less, however it writes it - plus its twin on the
  // other rail, DERIVED from the same written path. Both doors sell the same resource, so a row
  // that is right about one and wrong about the other is still a dead url for somebody.
  if (f.endsWith("README.md")) {
    for (const m of text.matchAll(/(?:^|[\s(`"'])(\/x402\/[a-z0-9-]+)/g)) {
      urls.add(ROUTER + m[1]);
      urls.add(ROUTER + m[1].replace("/x402/", "/tempo/"));
    }
    for (const m of text.matchAll(/(?:^|[\s(`"'])(\/tempo\/[a-z0-9-]+)/g)) urls.add(ROUTER + m[1]);
  }
}
check("the repository hands out urls, and every file was read for them", urls.size > 8, urls.size);

/** What this url is, and so what answering means for it - never a list written twice. */
function expected(u) {
  const { hostname, pathname } = new URL(u);
  if (hostname !== "router.sasona.ai") return { method: "GET", ok: [200], says: "answers" };
  if (pathname === "/x402/buy" || pathname === "/tempo/buy")
    return { method: "POST", ok: [400], says: "exists and refuses an empty call" };
  if (pathname.startsWith("/x402/")) return { method: "POST", ok: [402], says: "answers with a price" };
  // The MPP rail prices on the www-authenticate header and takes POST only; a GET here answers
  // 405 and said nothing about whether the resource exists.
  if (pathname.startsWith("/tempo/")) return { method: "POST", ok: [402], says: "answers with a price on Tempo" };
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
