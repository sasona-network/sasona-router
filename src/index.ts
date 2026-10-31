/**
 * A client for the Sasona router: ask for a price, pay it, get the answer.
 *
 * It is deliberately small. x402 is the standard and the router speaks it, so there is nothing
 * here you could not write yourself against the plain-text interface at https://router.sasona.ai/
 * - this file exists so you do not have to.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const ROUTER = "https://router.sasona.ai";
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/**
 * The compute budget on the transfer. These are the two values the router's own signer puts on a
 * payment it builds (`COMPUTE_UNIT_LIMIT` / `COMPUTE_UNIT_PRICE` in its signer), so a payment
 * built here looks to the facilitator exactly like one built there - which is the point. A plain
 * token transfer uses a fraction of this.
 */
const CU_LIMIT = 60_000;
const CU_PRICE = 1;
/** $0.10. The dearest resource listed today is $0.07. */
export const DEFAULT_MAX_MICROS = 100_000;

export type Requirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { feePayer?: string };
};

export type Answer = {
  resource?: string;
  service?: string;
  ref: string;
  delivered: boolean;
  verified?: boolean;
  rule: string;
  answer: string | null;
  contentType?: string;
  bytes?: number;
  // Both are absent when nothing was bought: a 502 that carries only `error` is a normal answer
  // from this router, and declaring them present made `out.paid.micros` a crash on a refusal.
  paid?: { micros: number; tx: string };
  seller?: { paid: boolean; tx: string; network?: string; protocol?: string };
  refund?: { tx: string; micros: number; landed: boolean };
  repeated?: boolean;
  alsoAt?: string;
  error?: string;
};

export type CallOptions = {
  /** The resource url, e.g. `${ROUTER}/x402/run-code`. */
  url: string;
  /** What that resource takes. `{}` for a resource that takes no input of its own. */
  body?: Record<string, unknown>;
  /** The wallet that pays. It needs USDC and nothing else: the network fee is paid for you. */
  payer: Keypair;
  /**
   * The most this call may cost, in micro-dollars. Default $0.10, which buys any resource this
   * router lists today - the dearest is $0.07. Set it to what the call is worth to you: it is
   * checked against the price before anything is signed, and $0.02 would refuse two of them.
   */
  maxMicros?: bigint | number;
  /** A Solana RPC. Default: the public mainnet endpoint, which rate-limits. */
  rpc?: string;
  /** The network and asset you expect. Defaults are Solana mainnet and USDC. */
  network?: string;
  asset?: string;
  fetchImpl?: typeof fetch;
};

export class RouterError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = "RouterError";
  }
}

/** The price for one call, without paying anything. */
export async function quote(o: Omit<CallOptions, "payer">): Promise<{ requirements: Requirements; body: any }> {
  const f = o.fetchImpl ?? fetch;
  const r = await f(o.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(o.body ?? {}),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status !== 402) throw new RouterError(`expected 402, got ${r.status}`, r.status, body);
  const requirements = (body.accepts ?? [])[0];
  if (!requirements) throw new RouterError("the 402 carries no accepts[0]", r.status, body);
  return { requirements, body };
}

/** The resources this router sells, with their prices, rules and schemas. */
export async function resources(router = ROUTER, fetchImpl: typeof fetch = fetch) {
  const r = await fetchImpl(`${router}/.well-known/x402.json`);
  if (!r.ok) throw new RouterError(`discovery answered ${r.status}`, r.status, null);
  return (await r.json()).resources as Array<{
    url: string; name: string; description: string; input: string; rule: string;
    network: string; asset: string; payTo: string;
  }>;
}

/**
 * Ask, pay, and return the answer.
 *
 * Nothing is signed before the price has been checked against what you asked for: the network,
 * the asset, the scheme and your own ceiling. A payer with no USDC account, or less than the
 * price, stops before signing - this never creates an account on your behalf.
 */
export async function call(o: CallOptions): Promise<Answer> {
  const f = o.fetchImpl ?? fetch;
  const network = o.network ?? SOLANA_MAINNET;
  const asset = o.asset ?? USDC_MAINNET;
  const max = BigInt(o.maxMicros ?? DEFAULT_MAX_MICROS);

  const { requirements: req } = await quote(o);
  const amount = BigInt(req.amount ?? "0");
  if (req.network !== network) throw new RouterError(`it asks on ${req.network}, not ${network}`, 402, req);
  if (req.asset !== asset) throw new RouterError(`it asks in ${req.asset}, not the asset you named`, 402, req);
  if (req.scheme !== "exact") throw new RouterError(`scheme ${req.scheme} is not one this client pays`, 402, req);
  if (amount <= 0n || amount > max) throw new RouterError(`the price ${amount} is outside your ceiling ${max}`, 402, req);
  const feePayer = req.extra?.feePayer;
  if (!feePayer) throw new RouterError("the 402 names no fee payer, so this wallet would need SOL", 402, req);

  const conn = new Connection(o.rpc ?? "https://api.mainnet-beta.solana.com", "confirmed");
  const mint = new PublicKey(asset);
  const from = getAssociatedTokenAddressSync(mint, o.payer.publicKey);
  // An address off the curve is a program's, not a wallet's, and the library throws its own error
  // for it. A caller of this client should only ever have to catch one kind.
  let to;
  try {
    to = getAssociatedTokenAddressSync(mint, new PublicKey(req.payTo));
  } catch (e) {
    throw new RouterError(`the 402 names a payTo this client cannot pay: ${req.payTo}`, 402, String(e));
  }
  // A wallet we could not read and a wallet that holds nothing are not the same thing: saying the
  // second when it was the first sends you looking at the wrong problem.
  let held;
  try {
    held = await conn.getTokenAccountBalance(from);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (/could not find account|not found|invalid param/i.test(why)) {
      throw new RouterError("the payer holds no account in that asset", 0, { account: from.toBase58() });
    }
    throw new RouterError(`the rpc did not answer, so nothing was signed: ${why}`, 0, { rpc: o.rpc ?? "default" });
  }
  if (BigInt(held.value.amount) < amount) {
    throw new RouterError(`the payer holds ${held.value.amount}, the price is ${amount}`, 0, null);
  }
  const decimals = held.value.decimals;

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: new PublicKey(feePayer),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE }),
      createTransferCheckedInstruction(from, mint, to, o.payer.publicKey, amount, decimals),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([o.payer]);      // our slot only; the fee payer signs when it settles

  const payload = {
    x402Version: 2,
    scheme: req.scheme,
    network: req.network,
    accepted: req,
    payload: { transaction: Buffer.from(tx.serialize()).toString("base64") },
  };

  const paid = await f(o.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64"),
    },
    body: JSON.stringify(o.body ?? {}),
  });
  const out = (await paid.json().catch(() => ({}))) as Answer;
  if (paid.status !== 200 && paid.status !== 502) {
    throw new RouterError(`the router answered ${paid.status}`, paid.status, out);
  }
  return out;
}

export type BuyOptions = Omit<CallOptions, "url" | "body"> & {
  /** The seller's own paid url. Its 402 is read at the moment you call, whatever rail it asks for. */
  service: string;
  /** The body THAT service expects, in its own shape - not ours. */
  body?: Record<string, unknown>;
  /** POST unless the seller wants PUT or PATCH. */
  method?: "POST" | "PUT" | "PATCH";
  /** Another router, for a test deployment. Default the live one. */
  router?: string;
};

/**
 * Buy one call of a service YOU name - any paid endpoint, not only the ones listed here.
 *
 * The exchange is the one above: a price, a payment, an answer. What is promised is less, and the
 * answer says so. Nobody has written a rule for a service we have not tested, so what is checked
 * is that it answered - and when it does not, you are refunded in full.
 *
 * If the service turns out to be one that already has a url of its own here, the price names it
 * (`alsoAt`): the same call costs the same there, and anything tested is tested there.
 */
export async function buy(o: BuyOptions): Promise<Answer> {
  return call({ ...named(o), payer: o.payer });
}

/** The price of a call you name, without paying for it. */
export async function quoteService(o: Omit<BuyOptions, "payer">) {
  return quote(named(o));
}

/**
 * The general resource's url and the body it takes, from what you named.
 *
 * One place, so a price and the payment that follows it cannot be built differently - and the url
 * is checked here rather than in one of the two, which is how the price request ended up sending
 * anything at all while the payment refused it.
 */
function named<T extends Omit<BuyOptions, "payer">>(o: T) {
  if (!o.service?.startsWith("https://")) {
    throw new RouterError("service must be the https url of the seller's own paid endpoint", 0, o.service);
  }
  const { service, body, method, router, ...rest } = o;
  return {
    ...rest,
    url: `${router ?? ROUTER}/x402/buy`,
    body: { service, ...(body ? { body } : {}), ...(method ? { method } : {}) },
  };
}
