# Sasona Router — the client

An AI agent that wants a paid API usually finds it priced in a protocol it does not speak, on a
chain it holds nothing on. The **Sasona router** is a live service that crosses that gap: your
agent pays it once, on a rail it already holds money on, it pays the service in whatever that
service's own `402 Payment Required` asks for, and you get the answer back.

It works in both directions, as of 1 November 2026:

| you pay | url | how |
| --- | --- | --- |
| x402, USDC on Solana | `/x402/<resource>` | the price is in the body and the `PAYMENT-REQUIRED` header; the payment goes on `payment-signature` |
| MPP, USDC.e on Tempo | `/tempo/<resource>` | the price is on the `www-authenticate` header; the credential goes on `authorization` |

Either url buys the same resource and returns the same answer. **This client speaks the Solana
side.** The Tempo side is plain HTTP too and any MPP client reaches it — the section
[Paying on Tempo](#paying-on-tempo) has the exchange.

```
the router    https://router.sasona.ai      ← the service, hosted by us
this repo     a small client for it         ← what you call it with
```

**This repository is not the router.** It is one file that speaks to it: it asks the price, checks
the price against what you expect, signs one USDC transfer, and hands you the answer. The router is
plain HTTP and the standard is public, so you can do every bit of this with `curl` and your own
signing code — read the interface in words at `https://router.sasona.ai/` — and this exists so you
do not have to.

No account. No API key. No wallet on the seller's chain. No SOL for fees. One HTTP call, one
signed payment, one answer.

---

## What the router is for

- **agent payments** — pay per call, machine to machine, with no human in the loop
- **x402** — the HTTP 402 payment standard, as a client and as a server
- **MPP on Tempo** — paid for you if you pay on Solana, and taken from you if you would rather
  pay there; either way your agent touches one chain
- **pay-per-call APIs** — price read from the seller at the moment of the call, never a list of ours
- **micropayments in USDC on Solana** — cents and fractions of cents, settled on chain

If no answer arrives, or the answer fails the rule published **before** you paid, you are refunded
in full, on chain.

---

## Quickstart

It is not on npm. Take the file:

```bash
git clone https://github.com/sasona-network/sasona-router.git
cd sasona-router
npm install @solana/web3.js @solana/spl-token
```

Or copy `src/index.ts` into your own project — it imports nothing but those two packages.

`bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)` on the first line of
every run is a warning from inside `@solana/web3.js`, not from here. There is nothing to rebuild
and nothing is wrong.

```ts
import { Keypair } from "@solana/web3.js";
import { call } from "./src/index";

const buyer = Keypair.fromSecretKey(/* your own key, from your own store */);

const out = await call({
  url: "https://router.sasona.ai/x402/run-code",
  body: { input: "print(6*7)" },
  payer: buyer,
});

console.log(out.answer);        // {"stdout": "42\n", ...}
console.log(out.paid.tx);       // your payment, on Solana
console.log(out.seller.tx);     // our payment to the service, on its own chain
```

`call()` does the whole exchange: it asks for a price, checks the price is on the network and in
the asset you expect, signs one USDC transfer, asks again with the payment, and hands you the
answer. It refuses to pay above `maxMicros` (default $0.10, which buys any resource below), refuses a network or an asset that is
not the one you asked for, and never creates a token account.

Read the interface in plain text at any time:

```bash
curl https://router.sasona.ai/
curl https://router.sasona.ai/.well-known/x402.json      # the resources alone, machine readable
```

---

## How a call works

Two requests to the same url.

**1. Ask.** `POST` the resource url with your body and no payment.

```
402 Payment Required
PAYMENT-REQUIRED: <base64 of the body below>

{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "amount": "7900",
    "asset":  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "payTo":  "8HdCdZ1Vao3uDazrVLxatDJawNckdBw5Aa9hTw7Z12V",
    "maxTimeoutSeconds": 120,
    "extra": { "feePayer": "…" }
  }],
  "rule": "what your answer will be judged by, before you pay"
}
```

The **fee payer** in `extra` pays the Solana network fee, so your wallet needs only the USDC it is
spending. A price is good for 120 seconds and pays for one call.

**2. Pay.** `POST` the **same url again** with the signed payment in the `payment-signature`
header (base64 of the x402 payload). You get `200` and your answer, or `502` and your refund.

```json
{
  "resource": "run-code",
  "ref": "dr_c0f0d58b53",
  "delivered": true,
  "rule": "the buyer's own input: the answer must have the service's shape",
  "answer": "{\"stdout\": \"42\\n\"}",
  "paid":   { "micros": 7900, "tx": "318rTws3…" },
  "seller": { "paid": true, "tx": "0x5006232a…" }
}
```

**Lost the answer?** Send the same payment again. You get the same answer back, marked
`"repeated": true`, and nothing is bought a second time. The payment you already hold is the
receipt — there is no idempotency key to invent or keep.

---

## Paying on Tempo

The same resources, paid in USDC.e on Tempo over MPP. Nothing about the resource changes: same
body, same rule, same refund, same answer. What changes is where the price and the payment sit.

**1. Ask.** `POST` the `/tempo` url with your body and no payment.

```
402 Payment Required
www-authenticate: Payment id="...", realm="router.sasona.ai", method="tempo",
                  intent="charge", request="<base64url>", expires="...", opaque="..."
```

`request` decodes to the amount, the currency and the chain:

```json
{
  "amount": "7900",
  "currency": "0x20c000000000000000000000b9537d11c60e8b50",
  "methodDetails": { "chainId": 4217 },
  "recipient": "0x58826405858e4465c807F28931a2d5904C8f4a36"
}
```

**2. Pay.** `POST` the same url again with the credential on `authorization: Payment …`. You get
`200` and your answer, with the receipt on `authentication-info`.

See the price for yourself, without paying:

```bash
curl -i -X POST https://router.sasona.ai/tempo/run-code   -H 'content-type: application/json'   -d '{"input":"print(6*7)"}'
```

This client does not build that credential — it signs Solana transfers and nothing else. The
reference client that does is [`mppx`](https://www.npmjs.com/package/mppx), which is what we pay
Tempo sellers with ourselves.

`POST /tempo/buy` takes any paid endpoint by url, exactly as `/x402/buy` does, so a buyer holding
USDC.e on Tempo and nothing on Solana can pay for a service that settles only in x402 USDC there.
That crossing ran on mainnet on 1 November 2026: the payment to us on Tempo was
`0x1bed21aef1a8f0b9293a838511b5381bcbf670018bfef055fc220b55688deaba`, our payment to the service
on Solana was
`HVcNrcGb9RZixMG5SLgp238KR9q1aBM38Q5tyJrt3fucrDmoTkvF6kNNkZfwL9foUWjS5PHMGA5rrU8SSqQ5zF3`, and
both are on chain to read.

---

## What you can buy

Each resource has a url of its own, a price read from its seller at the moment you call, and a
rule published before you pay.

Each one answers at the url below **and** at the same name under `/tempo/` — `/x402/run-code`
and `/tempo/run-code` are the same resource, bought on different rails.

| resource | what it returns | the service behind it | we pay it in |
| --- | --- | --- | --- |
| `POST /x402/run-code` | runs Python and returns stdout, status, time, memory | Judge0 | MPP, USDC on Tempo |
| `POST /x402/price` | the USD price of a Solana token, live | Codex | MPP, USDC on Tempo |
| `POST /x402/big-wallets` | net flow of wallets labelled smart money, 1h and 24h | Nansen | x402, USDC on Solana |
| `POST /x402/news` | latest articles on a ticker, each with a sentiment score | Alpha Vantage | MPP, USDC on Tempo |
| `POST /x402/trending` | the coins the market is searching for right now | CoinGecko | MPP, USDC on Tempo |
| `POST /x402/ipinfo-ip-lite` | where an IP address is | IPinfo | MPP, USDC on Tempo |
| `POST /x402/glim-search` | recent posts on X matching a term | glim.sh | MPP, USDC on Tempo |
| `POST /x402/api-inspect-certificate` | a host's TLS certificate: expiry, names, fingerprint, TLS version | api.mekler.ai | x402, USDC on Solana |

The price you are given is read from the seller at the moment you ask. The live list, with every
price and schema, is always `GET /.well-known/x402.json` — that file is the authority, not this
table.

The last three rows are there because somebody bought them through `/x402/buy` or `/tempo/buy` and
they answered; that is how a resource gets a url here.

## Anything else you already know about

What is listed is not the limit: name any paid endpoint and we read
**its** 402, pay it on whichever rail it asks for, and hand back what came.

```ts
import { buy, quoteService } from "./src/index";

// what it would cost, without paying for it
const { requirements } = await quoteService({ service: "https://any-seller.example/paid-endpoint" });

const out = await buy({
  service: "https://any-seller.example/paid-endpoint",
  body: { what: "it expects" },     // that seller's own shape, not ours
  payer: buyer,
});
console.log(out.answer, out.verified);   // verified is false, and means it
```

```bash
SERVICE=https://any-seller.example/paid-endpoint npm run example:any
```

That prints the price and stops; add `KEY=` to pay for the call.

What is promised here is less, and the answer says so: nobody has written a rule for a service we
have not tested, so what is checked is that it answered — and if it does not, you are refunded in
full.

A service bought this way gets a url of its own here, so the next agent finds it by searching
instead of having to know the url — `/x402/ipinfo-ip-lite` in the table above is one. When that
happens the answer carries `alsoAt`, the url it now has.

---

## What is guaranteed

- **You pay first and are refunded in full** when there is no answer, or the answer fails the
  published rule. The refund is a transaction on chain, in the same call.
- **The price is the seller's own**, read from its 402 at the moment you ask, plus 15%, plus a
  flat $0.001 for settling the payment on chain. The flat part is most of what you pay over the
  seller's price on the cheapest calls: a $0.001 service costs you $0.00215. It is never taken
  from a list of ours that could be stale.
- **Every hop is readable.** Your payment on Solana, our payment to the seller on its chain. Both
  transaction ids come back with the answer.
- **One payment buys one call.** The same payment, sent again, returns the same answer.

## What is not

- A resource marked `verified: false`, and everything under `/x402/buy`, carries no tested rule.
  What is checked there is that the service answered.
- Paying us on Tempo is open, but **this client cannot do it**: it signs Solana transfers and
  nothing else. Use an MPP client for that side, or curl and your own signing.

---

## Errors

| status | what it means |
| --- | --- |
| `400` | the body is not what the resource takes; the message says what it takes |
| `402` | a price (no payment sent), or the payment sent is not the one asked for |
| `404` | no such resource — the answer lists the ones there are |
| `409` | that price is gone, or the request changed; ask for a price again |
| `413` | the input is larger than the service takes |
| `415` | the request did not say it was JSON |
| `429` | more than 30 calls a minute from one address; a purchase takes two of them |
| `502` | no answer, or it failed the rule: see `refund`, which is everything you paid |
| `503` | we cannot sell right now, and nothing was charged |

---

## Where it runs

Solana mainnet for what you pay, and the seller's own chain for what we pay. The services behind
the resources are other people's; Sasona is the seller of record for the call you make, which is
why every resource carries a rule and a refund.

- the router: `https://router.sasona.ai`
- the network: [sasona.ai](https://sasona.ai)
- the explorer, with every agent, payment and crossing: [beta.sasona.ai/explorer](https://beta.sasona.ai/explorer)

## Licence

MIT. See [LICENSE](LICENSE).
