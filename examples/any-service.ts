/**
 * Buy one call of a service you name - any paid endpoint, not only the ones this router lists.
 *
 *   SERVICE=https://some-seller.example/paid-endpoint npx tsx examples/any-service.ts
 *   SERVICE=… BODY='{"ip":"8.8.8.8"}' KEY=/path/to/keypair.json npx tsx examples/any-service.ts
 *
 * Without KEY it only asks the price and stops - nothing is signed and nothing is spent. With KEY
 * it pays, and KEY is a Solana keypair file holding USDC and nothing else.
 *
 * What is promised here is less than for a listed resource, and the answer says so: nobody has
 * written a rule for a service we have not tested, so what is checked is that it answered - and if
 * it does not, you are refunded in full.
 */
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { buy, quoteService, type RouterError } from "../src/index";

const service = process.env.SERVICE;
if (!service) {
  console.error("SERVICE=https://the-seller/paid-endpoint is required");
  process.exit(1);
}
const body = process.env.BODY ? (JSON.parse(process.env.BODY) as Record<string, unknown>) : undefined;

// A seller that will not price this very call is a normal answer, not a crash: it is told to us
// as an error with the seller's own status in it, and printing that is more use than a stack
// trace. The commonest cause is a body the seller rejects - most of them need one.
let priced;
let requirements;
try {
  ({ requirements, body: priced } = await quoteService({ service, body }));
} catch (e) {
  const r = e as RouterError;
  console.error(`no price for that call: ${r.message}`);
  console.error(JSON.stringify(r.body ?? {}, null, 1));
  console.error(body ? "" : "it was asked with no body - try BODY='{...}' with what that seller expects");
  process.exitCode = 1;
}

if (priced && requirements) {
  console.log(`price      ${Number(requirements.amount) / 1e6} USDC   on ${requirements.network}`);
  console.log(`the seller ${JSON.stringify(priced.sellerAsks ?? {})}`);
  console.log(`promised   ${priced.rule}`);
  if (priced.alsoAt) console.log(`also at    ${priced.alsoAt}\n           ${priced.alsoAtNote}`);

  const keyPath = process.env.KEY;
  if (!keyPath) {
    console.log("\nno KEY given, so nothing was paid. Set KEY to buy this call.");
  } else {
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));

    // MOST is your ceiling in micro-dollars; left out it is $0.10.
    const out = await buy({ service, body, payer, maxMicros: Number(process.env.MOST ?? 100_000) });
    console.log(`\ndelivered  ${out.delivered}   verified ${out.verified}`);
    console.log(`answer     ${String(out.answer ?? out.error ?? "").slice(0, 300)}`);
    // Absent when nothing was bought, which is a normal answer here.
    if (out.paid) console.log(`you paid   ${out.paid.micros / 1e6} USDC   ${out.paid.tx}`);
    if (out.seller) console.log(`the seller ${out.seller.paid ? "was paid" : "was not paid"}   ${out.seller.tx}`);
    if (out.refund) console.log(`refunded   ${out.refund.micros / 1e6} USDC   ${out.refund.tx}`);
    if (out.alsoAt) console.log(`now at     ${out.alsoAt}   (its own url here, from this purchase)`);
  }
}
