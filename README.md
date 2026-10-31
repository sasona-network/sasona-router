# Sasona Router — one payment, any paid API, on the chain your agent already holds money on

An AI agent that wants a paid API usually finds it priced in a protocol it does not speak, on a
chain it holds nothing on. Sasona is an **x402 router**: your agent pays once in USDC on Solana,
we pay the service in whatever its own `402 Payment Required` asks for — x402 on another chain,
or MPP on Tempo — and you get its answer back.

No account. No API key. No wallet on the seller's chain. No SOL for fees. One HTTP call, one
signed payment, one answer.

```
https://router.sasona.ai
```

---

## What this is for

- **agent payments** — pay per call, machine to machine, with no human in the loop
- **x402** — the HTTP 402 payment standard, as a client and as a server
- **MPP on Tempo** — paid for you, so your agent never touches that chain
- **pay-per-call APIs** — price read from the seller at the moment of the call, never a list of ours
- **micropayments in USDC on Solana** — cents and fractions of cents, settled on chain

If no answer arrives, or the answer fails the rule published **before** you paid, you are refunded
in full, on chain.

---

## Quickstart

```bash
npm install @solana/web3.js @solana/spl-token
```

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
answer. It refuses to pay above `maxMicros` (default $0.02), refuses a network or an asset that is
not the one you asked for, and never creates a token account.

Read the interface in plain text at any time:

```bash
curl https://router.sasona.ai/
curl https://router.sasona.ai/.well-known/x402.json      # the same, machine readable
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
    "extra": { "feePayer": "…" },
    "extensions": { "bazaar": { "info": …, "schema": … } }
  }],
  "rule": "what your answer will be judged by, before you pay"
}
```

The **fee payer** in `extra` is the facilitator: it pays the Solana network fee, so your wallet
needs only the USDC it is spending. A price is good for 120 seconds and pays for one call.

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

## What you can buy

Each resource has a url of its own, a price read from its seller at the moment you call, and a
rule published before you pay.

| resource | what it returns | the service behind it | we pay it in |
| --- | --- | --- | --- |
| `POST /x402/run-code` | runs Python and returns stdout, status, time, memory | Judge0 | MPP, USDC on Tempo |
| `POST /x402/price` | the USD price of a Solana token, live | Codex | MPP, USDC on Tempo |
| `POST /x402/big-wallets` | net flow of wallets labelled smart money, 1h and 24h | Nansen | x402, USDC on Solana |
| `POST /x402/news` | latest articles on a ticker, each with a sentiment score | Alpha Vantage | MPP, USDC on Tempo |
| `POST /x402/trending` | the coins the market is searching for right now | CoinGecko | MPP, USDC on Tempo |

The live list, with prices and schemas, is always `GET /.well-known/x402.json`.

### Anything else you already know about

```ts
await call({
  url: "https://router.sasona.ai/x402/buy",
  body: { service: "https://any-seller.example/paid-endpoint", body: { what: "it expects" } },
  payer: buyer,
});
```

Name any paid endpoint and we read **its** 402, pay it on whichever rail it asks for, and hand
back what came. What is promised there is less, and the answer says so: nobody has written a rule
for a service we have not tested, so what is checked is that it answered — and if it does not,
you are refunded in full.

A service bought this way becomes a resource with a url of its own, so the next agent finds it by
searching instead of having to know the url.

---

## What is guaranteed

- **You pay first and are refunded in full** when there is no answer, or the answer fails the
  published rule. The refund is a transaction on chain, in the same call.
- **The price is the seller's own**, read from its 402 at the moment you ask, plus 15% and the
  settlement cost. It is never taken from a list of ours that could be stale.
- **Every hop is readable.** Your payment on Solana, our payment to the seller on its chain. Both
  transaction ids come back with the answer.
- **One payment buys one call.** The same payment, sent again, returns the same answer.

## What is not

- A resource marked `verified: false`, and everything under `/x402/buy`, carries no tested rule.
  What is checked there is that the service answered.
- Being paid **in** MPP on Tempo is reserved at `/tempo/<resource>` and is not open: selling there
  means receiving there, and we have no receiving address on Tempo yet. Ask it and it says so.

---

## Errors

| status | what it means |
| --- | --- |
| `400` | the body is not what the resource takes; the message says what it takes |
| `402` | a price (no payment sent), or the payment sent is not the one asked for |
| `404` | no such resource — the answer lists the ones there are |
| `409` | that price is gone, or the request changed; ask for a price again |
| `413` | the input is larger than the service takes |
| `429` | too many calls from one address |
| `502` | no answer, or it failed the rule: see `refund`, which is everything you paid |
| `503` | we cannot sell right now, and nothing was charged |

---

## Where it runs

Solana mainnet for what you pay, and the seller's own chain for what we pay. The services behind
the resources are other people's; Sasona is the seller of record for the call you make, which is
why every resource carries a rule and a refund.

- the router: `https://router.sasona.ai`
- the network: [sasona.ai](https://sasona.ai)
- the explorer, with every agent, payment and crossing: [sasona.ai/explorer](https://sasona.ai/explorer)

## Licence

MIT. See [LICENSE](LICENSE).
