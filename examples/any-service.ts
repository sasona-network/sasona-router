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
import { buy, quoteService } from "../src/index";

const service = process.env.SERVICE;
if (!service) {
  console.error("SERVICE=https://the-seller/paid-endpoint is required");
  process.exit(1);
}
const body = process.env.BODY ? (JSON.parse(process.env.BODY) as Record<string, unknown>) : undefined;

const { requirements, body: priced } = await quoteService({ service, body });
console.log(`price      ${Number(requirements.amount) / 1e6} USDC   on ${requirements.network}`);
console.log(`the seller ${JSON.stringify(priced.sellerAsks ?? {})}`);
console.log(`promised   ${priced.rule}`);
if (priced.alsoAt) console.log(`also at    ${priced.alsoAt}\n           ${priced.alsoAtNote}`);

const keyPath = process.env.KEY;
if (!keyPath) {
  console.log("\nno KEY given, so nothing was paid. Set KEY to buy this call.");
} else {
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));

  const out = await buy({ service, body, payer, maxMicros: 20_000 });
  console.log(`\ndelivered  ${out.delivered}   verified ${out.verified}`);
  console.log(`answer     ${String(out.answer ?? out.error ?? "").slice(0, 300)}`);
  console.log(`you paid   ${out.paid.micros / 1e6} USDC   ${out.paid.tx}`);
  console.log(`the seller ${out.seller.paid ? "was paid" : "was not paid"}   ${out.seller.tx}`);
  if (out.refund) console.log(`refunded   ${out.refund.micros / 1e6} USDC   ${out.refund.tx}`);
  if (out.alsoAt) console.log(`now at     ${out.alsoAt}   (its own url here, from this purchase)`);
}
