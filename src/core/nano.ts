/**
 * Universal Commerce Protocol (UCP) - Nano (XNO) Settlement Verification
 * Zero-dependency stdlib implementation of an on-chain receipt check for the
 * Nano network. Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 *
 * A payment on Nano is a block. The receipt the merchant should trust is not a
 * token it signed itself but the public block a stranger can re-read. The one
 * thing that makes such a block a payment is that it CREDITS the pay-to
 * account, which on Nano is two different fields depending on the subtype:
 *
 *   receive (or open) : the funds land on the block's own account, so the block
 *                       is a payment when block_account === payTo.
 *   send              : the funds leave the block's own account for the account
 *                       in `link_as_account`, so the block is a payment when
 *                       link_as_account === payTo. block_account here is the
 *                       PAYER, never the payee.
 *
 * Reading block_account for both is what lets a stranger present one of the
 * merchant's own outgoing sends as proof of payment, so the two subtypes are
 * kept apart below and every missing field is a rejection.
 *
 * One payment is also TWO blocks: the payer's send and the merchant's receive
 * that pockets it. Both credit the pay-to account, so each verified block is
 * reduced to one payment id - the send's own hash, or for a receive the hash of
 * the send it pockets - and that id, not the presented hash, is what settles an
 * order. Otherwise one payment settles two orders.
 */

export interface NanoBlockInfo {
  /** the block hash that was queried */
  hash: string;
  /** whether the block exists (block_info returned data) */
  exists: boolean;
  /** whether the node reports the block as confirmed (cemented) */
  confirmed: boolean;
  /** block subtype as reported by the node, e.g. 'receive' | 'send' | 'change' */
  subtype?: string;
  /**
   * The account the block SITS ON (`block_account`). For a receive this is the
   * payee; for a send it is the PAYER. Never read it without checking subtype.
   */
  blockAccount?: string;
  /** for a send, the destination account the funds move TO (`link_as_account`) */
  linkAsAccount?: string;
  /** amount in raw (1 XNO = 10^30 raw) as a decimal string, when present */
  amountRaw?: string;
  /**
   * For a receive (or open), the hash of the send block it pockets
   * (`contents.link` on a state block, `contents.source` on a legacy one).
   */
  sourceHash?: string;
}

export type NanoRpcLookup = (blockHash: string) => Promise<NanoBlockInfo | null>;

/**
 * Default RPC lookup against a public Nano node via block_info.
 * The node is queried without authentication and never moves the payer's funds —
 * it only reads the state of one recorded block.
 */
export const defaultNanoRpcLookup: NanoRpcLookup = async (
  blockHash: string
): Promise<NanoBlockInfo | null> => {
  const endpoint =
    process.env.NANO_RPC_URL || 'https://rainstorm.city/api';
  const body = JSON.stringify({
    action: 'block_info',
    json_block: 'true',
    hash: blockHash,
  });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  if (!data || typeof data !== 'object' || data.error) return null;
  const contents = data.contents || {};
  return {
    hash: blockHash,
    exists: true,
    // block_info reports confirmed as the string "true" on a cemented block.
    confirmed: data.confirmed === true || data.confirmed === 'true',
    // `contents.type` is 'state' on a modern block; the subtype only ever
    // arrives top-level or, on a legacy block, as contents.type.
    subtype: data.subtype || contents.subtype || contents.type,
    blockAccount: (data.block_account as string) || (contents.account as string),
    linkAsAccount: contents.link_as_account as string,
    amountRaw: data.amount !== undefined ? String(data.amount) : undefined,
    sourceHash: (contents.source as string) || (contents.link as string),
  };
};

/** 1 XNO in raw = 10^30 */
export const XNO_RAW = 10n ** 30n;

/** raw is XNO scaled by 10^30, so 30 decimal places is the whole resolution */
const RAW_DECIMALS = 30;

/**
 * Exact decimal -> raw scaling on a decimal literal, including the exponent
 * forms JavaScript prints for small and large numbers (`String(1e-7)` is
 * `"1e-7"`, not `"0.0000001"`). Never goes through a float.
 */
function decimalLiteralToRaw(literal: string): bigint {
  if (literal.length > 256) throw new Error('nano amount literal is too long');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(literal.trim());
  if (!m || (!m[2] && !m[3])) {
    throw new Error(`nano amount is not a decimal number: ${literal}`);
  }
  const sign = m[1];
  const whole = m[2] || '';
  const frac = m[3] || '';
  const exp = Number(m[4] || '0');
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 128) {
    throw new Error('nano amount exponent is out of range');
  }
  if (sign === '-' && /[1-9]/.test(whole + frac)) {
    throw new Error('nano amount must be a non-negative finite number');
  }
  const digits = whole + frac || '0';
  // value = digits * 10^(exp - frac.length), and raw = value * 10^30
  const shift = RAW_DECIMALS + exp - frac.length;
  if (shift < 0) {
    // Finer than one raw. Refuse rather than silently truncate the amount a
    // block must carry: a short raw amount is money the merchant never gets.
    const dropped = digits.slice(shift);
    if (/[1-9]/.test(dropped)) {
      throw new Error(
        `nano amount ${literal} is finer than 1 raw (10^-${RAW_DECIMALS} XNO)`
      );
    }
    return BigInt(digits.slice(0, shift) || '0');
  }
  return BigInt(digits) * 10n ** BigInt(shift);
}

/**
 * Convert a decimal XNO amount (e.g. 0.00001, or the string "0.00001") to raw
 * subunits (1 XNO = 10^30 raw) as a decimal string. Performs exact decimal
 * scaling on the shortest round-trip decimal form, so floating-point or
 * trailing representation error can never change the raw amount a block must
 * carry. Pass a string for amounts a double cannot hold exactly.
 */
export function xnoToRaw(amountXno: number | string): string {
  if (typeof amountXno === 'number') {
    if (!Number.isFinite(amountXno) || amountXno < 0) {
      throw new Error('nano amount must be a non-negative finite number');
    }
    // String(num) yields the shortest decimal that round-trips to the same
    // value, which is what a merchant quoting "0.00001" actually intended.
    return decimalLiteralToRaw(String(amountXno)).toString();
  }
  return decimalLiteralToRaw(amountXno).toString();
}

/** Canonical decimal serialization, including signed savings, without a float. */
export function rawToXno(raw: bigint): string {
  const sign = raw < 0n ? '-' : '';
  const digits = (raw < 0n ? -raw : raw).toString().padStart(31, '0');
  const fraction = digits.slice(-30).replace(/0+$/, '');
  return sign + digits.slice(0, -30) + (fraction ? '.' + fraction : '');
}

/** Exact quote multiplication. A fractional raw is rejected rather than rounded. */
export function xnoTotal(unitPrice: number, quantity: number): bigint {
  const scaled = BigInt(xnoToRaw(unitPrice)) * BigInt(xnoToRaw(quantity));
  if (scaled % XNO_RAW !== 0n) throw new Error('nano quote total is finer than 1 raw');
  return scaled / XNO_RAW;
}

/**
 * Verify a Nano block as the receipt for a payment:
 *  - the block exists on the public chain and the node reports it confirmed,
 *  - it credits the expected pay-to account (a receive ON that account, or a
 *    send whose destination IS that account),
 *  - its raw amount is at least the expected amount in raw.
 *
 * Fail-closed: any unreadable, unconfirmed, missing, or mismatched block is a
 * rejection, and so is a block whose payee field the node did not report.
 *
 * This says only that the block credits the merchant. It does NOT say the
 * payment has not already paid for something else — one payment settles one
 * order, and that is the caller's ledger to keep, keyed on the returned
 * `paymentId` (see NanoReceiptLedger in x402.ts).
 */
export async function verifyNanoReceipt(
  blockHash: string,
  expectedPayTo: string,
  expectedRaw: string,
  lookup: NanoRpcLookup = defaultNanoRpcLookup
): Promise<{
  verified: boolean;
  reason?: string;
  info?: NanoBlockInfo;
  /** the send block this payment is, whichever of its two blocks was presented */
  paymentId?: string;
}> {
  if (!blockHash || !/^[0-9A-F]{64}$/i.test(blockHash)) {
    return { verified: false, reason: 'Nano block hash must be 64 hex chars' };
  }
  if (!expectedPayTo || !expectedPayTo.startsWith('nano_')) {
    return { verified: false, reason: 'Expected pay-to is not a nano_ address' };
  }
  const info = await lookup(blockHash);
  if (!info || !info.exists) {
    return { verified: false, reason: 'Block not found on the public chain' };
  }
  if (!info.confirmed) {
    return {
      verified: false,
      reason: 'Block is not confirmed on the public chain yet',
      info,
    };
  }

  // Which field names the payee depends entirely on the subtype.
  let payee: string | undefined;
  let paymentId: string;
  if (info.subtype === 'receive' || info.subtype === 'open') {
    payee = info.blockAccount;
    if (!payee) {
      return {
        verified: false,
        reason: 'Node reported no block account for the receive block',
        info,
      };
    }
    // The receive and the send it pockets are one payment: settle on the send.
    if (!info.sourceHash || !/^[0-9A-F]{64}$/i.test(info.sourceHash)) {
      return {
        verified: false,
        reason: 'Node reported no source send for the receive block',
        info,
      };
    }
    paymentId = info.sourceHash.toUpperCase();
  } else if (info.subtype === 'send') {
    // block_account on a send is the PAYER. The payee is the destination.
    payee = info.linkAsAccount;
    if (!payee) {
      return {
        verified: false,
        reason: 'Node reported no destination account for the send block',
        info,
      };
    }
    paymentId = blockHash.toUpperCase();
  } else {
    return {
      verified: false,
      reason: `Block is not a settlement block (subtype ${info.subtype || 'unknown'})`,
    };
  }

  if (payee !== expectedPayTo) {
    return {
      verified: false,
      reason: 'Block does not credit the expected pay-to account',
      info,
    };
  }
  if (info.amountRaw === undefined) {
    return { verified: false, reason: 'No amount recorded for the block', info };
  }
  let actualRaw: bigint;
  try {
    if (!/^[0-9]+$/.test(info.amountRaw)) throw new Error('Non-decimal raw');
    actualRaw = BigInt(info.amountRaw);
  } catch {
    return {
      verified: false,
      reason: `Block amount is not an integer raw value: ${info.amountRaw}`,
      info,
    };
  }
  const expected = BigInt(expectedRaw);
  if (actualRaw < expected) {
    return {
      verified: false,
      reason: `Block amount ${info.amountRaw} raw is below expected ${expectedRaw} raw`,
      info,
    };
  }
  return { verified: true, info, paymentId };
}
