/**
 * The guards this client puts between a price and a signature.
 *
 *     npm run check:client
 *
 * Everything the router says is a stand-in here (`fetchImpl`), and the payer is a key generated on
 * the spot with nothing in it. Nothing is signed and nothing is spent: what is checked is that the
 * client REFUSES, which is the whole reason to use it rather than posting the payment yourself. A
 * guard that stops working is silent - the call simply succeeds - so it is checked here instead of
 * being noticed later by somebody whose money went.
 *
 * One check does read the chain: a balance comes from an RPC, and a fresh key having no account
 * there is the honest way to watch that guard fire. It reads; it never writes.
 */
import { Keypair } from "@solana/web3.js";
import { call, quoteService, RouterError, ROUTER } from "../src/index";

const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const payer = Keypair.generate();
let fails = 0;

function check(name: string, ok: boolean, detail: unknown = "") {
  console.log((ok ? "PASS " : "FAIL ") + name + (detail === "" ? "" : `  (${String(detail).slice(0, 160)})`));
  if (!ok) fails++;
}

/** A router that answers one 402 of our choosing, and records anything sent after it. */
function router(accepts: Record<string, unknown>) {
  const sent: Request[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(String(url), init));
    if (sent.length === 1) {
      return new Response(JSON.stringify({ x402Version: 2, accepts: [accepts] }), {
        status: 402, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ref: "r", delivered: true, rule: "", answer: "{}", paid: {}, seller: {} }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, sent };
}

const priced = { scheme: "exact", network: SOLANA, amount: "7900", asset: USDC,
                 payTo: "8HdCdZ1Vao3uDazrVLxatDJawNckdBw5Aa9hTw7Z12V", extra: { feePayer: "F".repeat(43) } };

async function refuses(name: string, accepts: Record<string, unknown>, says: string, opts: Record<string, unknown> = {}) {
  const r = router(accepts);
  let message = "";
  try {
    await call({ url: `${ROUTER}/x402/run-code`, body: { input: "print(1)" }, payer, fetchImpl: r.impl, ...opts });
  } catch (e) {
    message = e instanceof RouterError ? e.message : `not a RouterError: ${String(e)}`;
  }
  // It has to refuse, say why, AND not have sent a second request: a payment posted and then
  // complained about is a payment that was made.
  check(name, message.includes(says) && r.sent.length === 1, `${message} | requests ${r.sent.length}`);
}

await refuses("a price on another chain is refused before anything is signed",
  { ...priced, network: "solana:devnet" }, "it asks on");
await refuses("a price in another asset is refused", { ...priced, asset: "So11111111111111111111111111111111111111112" }, "it asks in");
await refuses("a scheme this client does not pay is refused", { ...priced, scheme: "upto" }, "is not one this client pays");
await refuses("a price above your own ceiling is refused", { ...priced, amount: "900000" }, "outside your ceiling");
await refuses("a price of nothing is refused too", { ...priced, amount: "0" }, "outside your ceiling");
await refuses("a 402 with no fee payer is refused, rather than needing SOL you were not asked for",
  { ...priced, extra: {} }, "names no fee payer");
// And a price this client WOULD pay still stops at the wallet: a fresh key holds no USDC account,
// and this never creates one on somebody's behalf.
await refuses("a payer with no account in that asset stops before signing", priced, "holds no account");

// The general resource: a url that is not a seller's own https endpoint never leaves the process.
{
  const r = router(priced);
  let message = "";
  try {
    await quoteService({ service: "http://not-https.example/pay", fetchImpl: r.impl } as never);
  } catch (e) {
    message = e instanceof RouterError ? e.message : String(e);
  }
  check("a service url that is not https is refused by the client", r.sent.length === 0, `${message} | requests ${r.sent.length}`);
}

// What it sends when it does pay: the same url twice, and the payment in the header.
{
  const r = router(priced);
  try {
    await call({ url: `${ROUTER}/x402/run-code`, body: { input: "print(1)" }, payer, fetchImpl: r.impl });
  } catch {
    // the payer holds nothing, so this stops at the balance - the point here is the FIRST request
  }
  const first = r.sent[0];
  check("the price is asked for by posting the resource's own url", first?.url === `${ROUTER}/x402/run-code`, first?.url);
  check("and nothing is sent in that first request but the body", !first?.headers.get("payment-signature"), "payment-signature");
}

console.log();
console.log(fails ? `FAILED: ${fails}` : "ALL PASS");
process.exitCode = fails ? 1 : 0;
