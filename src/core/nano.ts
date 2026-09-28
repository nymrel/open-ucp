/**
 * Universal Commerce Protocol (UCP) - Nano (XNO) Settlement Verification
 * Zero-dependency stdlib implementation of an on-chain receipt check for the
 * Nano network. Copyright (c) 2026 Nymrel / JalenBuilds LLC. Licensed under MIT.
 *
 * A payment on Nano is a block. The receipt the merchant should trust is not a
 * token it signed itself but the public block a stranger can re-read: a receive
 * (or send) block on the pay-to account whose `amount` in raw meets the price.
 * This module verifies that claim against a public Nano node.
 */

export interface NanoBlockInfo {
  /** the block hash that was queried */
  hash: string;
  /** whether the block exists (block_info returned data) */
  exists: boolean;
  /** block subtype as reported by the node, e.g. 'receive' | 'send' | 'change' */
  subtype?: string;
  /** the account that owns the block ('account' field of contents) */
  account?: string;
  /** amount in raw (1 XNO = 10^30 raw) as a decimal string, when present */
  amountRaw?: string;
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
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  if (!data || typeof data !== 'object' || data.error) return null;
  const contents = data.contents || {};
  return {
    hash: blockHash,
    exists: true,
    subtype: data.subtype || contents.type,
    account:
      (contents.account as string) ||
      (contents.link_as_account as string),
    amountRaw: data.amount !== undefined ? String(data.amount) : undefined,
  };
};

/** 1 XNO in raw = 10^30 */
export const XNO_RAW = 10n ** 30n;

/**
 * Convert a decimal XNO amount (e.g. 0.00001, or the string "0.00001") to raw
 * subunits (1 XNO = 10^30 raw) as a decimal string. Performs exact decimal
 * scaling on the shortest round-trip decimal form, so floating-point or trailing
 * representation error can never change the raw amount a block must carry.
 */
export function xnoToRaw(amountXno: number | string): string {
  const num = typeof amountXno === 'number' ? amountXno : Number(amountXno);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('nano amount must be a non-negative finite number');
  }
  // String(num) yields the shortest decimal that round-trips to the same value,
  // which is what a merchant quoting "0.00001" actually intended.
  const dec = String(num);
  const [whole = '0', frac = ''] = dec.split('.');
  const digits = (whole + (frac || '').padEnd(30, '0')).replace(/^0+(?=\d)/, '') || '0';
  const raw = BigInt(digits);
  return raw.toString();
}

/**
 * Verify a Nano block as the receipt for a payment:
 *  - the block exists on the public chain,
 *  - it is a receive (or send) block whose account is the expected pay-to,
 *  - its raw amount is at least the expected amount in raw.
 *
 * Fail-closed: any unreadable, missing, or mismatched block is rejected.
 */
export async function verifyNanoReceipt(
  blockHash: string,
  expectedPayTo: string,
  expectedRaw: string,
  lookup: NanoRpcLookup = defaultNanoRpcLookup
): Promise<{ verified: boolean; reason?: string; info?: NanoBlockInfo }> {
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
  if (info.subtype !== 'receive' && info.subtype !== 'send') {
    return {
      verified: false,
      reason: `Block is not a settlement block (subtype ${info.subtype || 'unknown'})`,
    };
  }
  if (info.account && info.account !== expectedPayTo) {
    return {
      verified: false,
      reason: 'Block account does not match the expected pay-to',
    };
  }
  if (info.amountRaw === undefined) {
    return { verified: false, reason: 'No amount recorded for the block' };
  }
  const actualRaw = BigInt(info.amountRaw);
  const expected = BigInt(expectedRaw);
  if (actualRaw < expected) {
    return {
      verified: false,
      reason: `Block amount ${info.amountRaw} raw is below expected ${expectedRaw} raw`,
    };
  }
  return { verified: true, info };
}
