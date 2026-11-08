/** PayPal-only sandbox adapter contracts. Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export const SANDBOX_ORIGIN = 'https://api-m.sandbox.paypal.com';
export interface PurchaseIntent {
  version: 'paypal-sandbox/v1';
  environment: 'sandbox';
  intentId: string;
  merchantId: string;
  sku: string;
  name: string;
  quantity: number;
  /** This first adapter deliberately supports USD only, in exact decimal strings. */
  currency: 'USD';
  unitAmount: string;
  exactAmount: string;
  maxAmount: string;
  issuedAt: string;
  expiresAt: string;
}
export interface HumanApproval {
  version: 'paypal-sandbox-approval/v1';
  action: 'create-and-capture-exact-sandbox-order';
  intentDigest: string;
  approvedAt: string;
  /** Ed25519 over approvalPayload(). The trusted key comes from the human UI, never AI input. */
  signature: string;
}

export function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function record(value: unknown): Record<string, unknown> {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  const proto = Object.getPrototypeOf(value);
  requireCondition(proto === Object.prototype || proto === null, 'Expected plain object');
  return value as Record<string, unknown>;
}
export function exactKeys(value: unknown, keys: string[]): void {
  const actual = Object.keys(record(value)).sort();
  requireCondition(JSON.stringify(actual) === JSON.stringify([...keys].sort()), 'Unexpected or missing fields');
}
/** Stable JSON for bounded, JSON-only adapter values; rejects undefined, NaN, cycles and exotic objects. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireCondition(Number.isSafeInteger(value), 'Expected safe integer');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = record(value);
  return '{' + Object.keys(obj).sort().map(key => JSON.stringify(key) + ':' + canonical(obj[key])).join(',') + '}';
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function money(value: unknown): bigint {
  requireCondition(typeof value === 'string' && /^(0|[1-9]\d{0,5})\.\d{2}$/.test(value), 'Invalid USD amount');
  return BigInt(value.replace('.', ''));
}
export function instant(value: unknown): number {
  requireCondition(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), 'Invalid UTC timestamp');
  const parsed = Date.parse(value);
  requireCondition(Number.isFinite(parsed) && new Date(parsed).toISOString() === (value.includes('.') ? value : value.slice(0, -1) + '.000Z'), 'Invalid UTC timestamp');
  return parsed;
}
export function validateIntent(value: unknown): asserts value is PurchaseIntent {
  exactKeys(value, ['version', 'environment', 'intentId', 'merchantId', 'sku', 'name', 'quantity', 'currency', 'unitAmount', 'exactAmount', 'maxAmount', 'issuedAt', 'expiresAt']);
  const i = record(value);
  requireCondition(i.version === 'paypal-sandbox/v1' && i.environment === 'sandbox', 'Sandbox intent required');
  for (const key of ['intentId', 'merchantId', 'sku']) {
    requireCondition(typeof i[key] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(i[key] as string), 'Invalid identifier');
  }
  requireCondition(typeof i.name === 'string' && /^[\x20-\x7E]{1,120}$/.test(i.name), 'Invalid item name');
  requireCondition(i.currency === 'USD', 'Only USD is supported');
  requireCondition(typeof i.quantity === 'number' && Number.isSafeInteger(i.quantity) && i.quantity > 0 && i.quantity <= 100, 'Invalid quantity');
  const unit = money(i.unitAmount), total = money(i.exactAmount), max = money(i.maxAmount);
  requireCondition(unit > 0n && total === unit * BigInt(i.quantity) && total <= max && max <= 10000n, 'Invalid total or $100 sandbox cap exceeded');
  const issued = instant(i.issuedAt), expires = instant(i.expiresAt);
  requireCondition(expires > issued && expires - issued <= 15 * 60_000, 'Intent lifetime must be at most 15 minutes');
}
export function intentDigest(intent: PurchaseIntent): string {
  validateIntent(intent);
  return digest(intent);
}
export function approvalPayload(approval: Omit<HumanApproval, 'signature'> | HumanApproval): string {
  return canonical({version: approval.version, action: approval.action, intentDigest: approval.intentDigest, approvedAt: approval.approvedAt});
}
/** Scope/signature check, not a human detector. The caller must authenticate the human and protect the signer. */
export function authorize(intent: PurchaseIntent, approval: HumanApproval, trustedKey: KeyObject | string, now: string): void {
  validateIntent(intent);
  exactKeys(approval, ['version', 'action', 'intentDigest', 'approvedAt', 'signature']);
  requireCondition(approval.version === 'paypal-sandbox-approval/v1' && approval.action === 'create-and-capture-exact-sandbox-order', 'Invalid approval action');
  requireCondition(approval.intentDigest === intentDigest(intent), 'Approval scope mismatch');
  const time = instant(now), approved = instant(approval.approvedAt);
  requireCondition(instant(intent.issuedAt) <= approved && approved <= time && time < instant(intent.expiresAt), 'Approval is premature or expired');
  requireCondition(typeof approval.signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(approval.signature), 'Invalid approval signature');
  const bytes = Buffer.from(approval.signature, 'base64url');
  requireCondition(bytes.toString('base64url') === approval.signature, 'Noncanonical approval signature');
  const key = typeof trustedKey === 'string' ? createPublicKey(trustedKey) : trustedKey;
  requireCondition(key.type === 'public' && key.asymmetricKeyType === 'ed25519', 'Trusted Ed25519 public key required');
  requireCondition(verify(null, Buffer.from(approvalPayload(approval)), key, bytes), 'Approval signature mismatch');
}
export function createOrderPlan(intent: PurchaseIntent, approval: HumanApproval, key: KeyObject | string, now: string) {
  authorize(intent, approval, key, now);
  const hash = intentDigest(intent);
  return {
    method: 'POST' as const,
    url: SANDBOX_ORIGIN + '/v2/checkout/orders',
    headers: {'Content-Type': 'application/json', Prefer: 'return=representation', 'PayPal-Request-Id': hash.slice(0, 32)},
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: intent.intentId, custom_id: hash,
        payee: {merchant_id: intent.merchantId},
        amount: {currency_code: intent.currency, value: intent.exactAmount, breakdown: {item_total: {currency_code: intent.currency, value: intent.exactAmount}}},
        items: [{name: intent.name, sku: intent.sku, quantity: String(intent.quantity), category: 'DIGITAL_GOODS', unit_amount: {currency_code: intent.currency, value: intent.unitAmount}}],
      }],
    },
  };
}
