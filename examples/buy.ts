/**
 * Buy one call and print what came back.
 *
 *   KEY=/path/to/keypair.json npx tsx examples/buy.ts
 *   KEY=… URL=https://router.sasona.ai/x402/price INPUT=So11111111111111111111111111111111111111112 npx tsx examples/buy.ts
 *
 * KEY is a Solana keypair file - the 64-byte JSON array `solana-keygen` writes. It needs USDC and
 * nothing else: the network fee is paid for you. Keep it out of your repository.
 */
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { call, resources, ROUTER } from "../src/index";

const keyPath = process.env.KEY;
if (!keyPath) {
  console.error("KEY=/path/to/keypair.json is required");
  process.exit(1);
}
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));

const url = process.env.URL ?? `${ROUTER}/x402/run-code`;
const body = process.env.INPUT ? { input: process.env.INPUT } : { input: "print(6*7)" };

console.log("what this router sells today:");
for (const r of await resources()) console.log(`  ${r.url}  ${r.name}`);

console.log(`\npaying for ${url} as ${payer.publicKey.toBase58()}`);
// MOST is your ceiling in micro-dollars; left out it is $0.10, which buys anything listed here.
const out = await call({ url, body, payer, maxMicros: Number(process.env.MOST ?? 100_000) });

console.log(`delivered  ${out.delivered}`);
console.log(`answer     ${String(out.answer ?? out.error ?? "").slice(0, 300)}`);
// `paid` and `seller` are absent when nothing was bought, and that is a normal answer here.
if (out.paid) console.log(`you paid   ${out.paid.micros / 1e6} USDC   ${out.paid.tx}`);
if (out.seller) console.log(`the seller ${out.seller.paid ? "was paid" : "was not paid"}   ${out.seller.tx}`);
if (out.refund) console.log(`refunded   ${out.refund.micros / 1e6} USDC   ${out.refund.tx}`);
