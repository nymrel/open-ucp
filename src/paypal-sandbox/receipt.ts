/** Reconciled, data-minimized sandbox evidence. Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. */
import type { KeyObject } from 'node:crypto';
import { authorize, canonical, digest, exactKeys, instant, intentDigest, money, record, requireCondition, validateIntent, type HumanApproval, type PurchaseIntent } from './authorization.js';

function one(value: unknown): Record<string, unknown> {
  requireCondition(Array.isArray(value) && value.length === 1, 'Exactly one item of evidence required');
  return record(value[0]);
}
function amount(value: unknown, expected: string): void {
  const a = record(value);
  requireCondition(a.currency_code === 'USD' && a.value === expected, 'Observed amount/currency mismatch');
  money(a.value);
}
function providerId(value: unknown): string {
  requireCondition(typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value), 'Invalid provider ID');
  return value;
}
/** Validate actual fields returned by PayPal; never substitute request fields for missing evidence. */
export function reconcileOrder(intent: PurchaseIntent, raw: unknown, status: 'CREATED' | 'APPROVED' | 'COMPLETED') {
  validateIntent(intent);
  const order = record(raw), unit = one(order.purchase_units), item = one(unit.items);
  requireCondition(order.intent === 'CAPTURE' && order.status === status, 'Unexpected order state');
  // The approved intent contains no platform fee, special pricing, FX override
  // or delayed release. A matching gross amount/payee must not hide those.
  if (Object.hasOwn(unit, 'payment_instruction')) {
    const instruction = record(unit.payment_instruction);
    requireCondition(Object.keys(instruction).every(key => key === 'disbursement_mode') &&
      (!Object.hasOwn(instruction, 'disbursement_mode') || instruction.disbursement_mode === 'INSTANT'),
    'Unsupported payment instructions; reconciliation required');
  }
  // This adapter permits one new, complete capture only. Never ignore evidence
  // of earlier settlement merely because the order still says APPROVED.
  if (status !== 'COMPLETED') {
    requireCondition(!Object.hasOwn(unit, 'payments'), 'Order already contains payment evidence; reconciliation required');
  }
  requireCondition(unit.reference_id === intent.intentId && unit.custom_id === intentDigest(intent), 'Observed intent binding mismatch');
  requireCondition(record(unit.payee).merchant_id === intent.merchantId, 'Observed merchant mismatch');
  amount(unit.amount, intent.exactAmount);
  const breakdown = record(record(unit.amount).breakdown);
  exactKeys(breakdown, ['item_total']);
  amount(breakdown.item_total, intent.exactAmount);
  requireCondition(item.sku === intent.sku && item.name === intent.name && item.quantity === String(intent.quantity) && item.category === 'DIGITAL_GOODS', 'Observed item mismatch');
  amount(item.unit_amount, intent.unitAmount);
  const normalized = {
    id: providerId(order.id), intent: 'CAPTURE', status,
    purchase_units: [{reference_id: unit.reference_id, custom_id: unit.custom_id,
      payee: {merchant_id: record(unit.payee).merchant_id},
      amount: {currency_code: 'USD', value: intent.exactAmount, breakdown: {item_total: {currency_code: 'USD', value: intent.exactAmount}}},
      items: [{name: item.name, sku: item.sku, quantity: item.quantity, category: item.category, unit_amount: {currency_code: 'USD', value: intent.unitAmount}}],
    }],
  };
  return normalized;
}
function successfulCapture(intent: PurchaseIntent, raw: unknown, approvedAt: string) {
  const capture = record(raw);
  requireCondition(capture.status === 'COMPLETED' && capture.final_capture === true, 'Capture is not final and completed');
  requireCondition(!Object.hasOwn(capture, 'disbursement_mode') || capture.disbursement_mode === 'INSTANT',
    'Unsupported capture disbursement; reconciliation required');
  if (Object.hasOwn(capture, 'seller_receivable_breakdown')) {
    requireCondition(!Object.hasOwn(record(capture.seller_receivable_breakdown), 'platform_fees'),
      'Unapproved platform fee; reconciliation required');
  }
  amount(capture.amount, intent.exactAmount);
  const at = instant(capture.create_time);
  requireCondition(at >= instant(approvedAt) && at < instant(intent.expiresAt), 'Capture outside approval lifetime');
  return {id: providerId(capture.id), status: 'COMPLETED', final_capture: true,
    amount: {currency_code: 'USD', value: intent.exactAmount}, create_time: capture.create_time as string};
}
export function completedOrder(intent: PurchaseIntent, raw: unknown, approvedAt: string) {
  const normalized = reconcileOrder(intent, raw, 'COMPLETED');
  const unit = one(record(raw).purchase_units), payments = record(unit.payments);
  exactKeys(payments, ['captures']);
  const capture = successfulCapture(intent, one(payments.captures), approvedAt);
  return {...normalized, capture};
}
export function createReceipt(input: {
  intent: PurchaseIntent; approval: HumanApproval; trustedKey: KeyObject | string;
  order: unknown; captureResponse: unknown; observedAt: string; mode: 'offline-fixture' | 'sandbox-api';
}) {
  const {intent, approval, trustedKey, observedAt, mode} = input;
  requireCondition(mode === 'offline-fixture' || mode === 'sandbox-api', 'Unknown evidence mode');
  const captured = record(input.captureResponse);
  const order = completedOrder(intent, input.order, approval.approvedAt);
  const result = completedOrder(intent, captured, approval.approvedAt);
  requireCondition(canonical(result) === canonical(order), 'Capture response and fetched order disagree');
  // Authorization must still be valid when the result is observed. A late result requires manual reconciliation.
  authorize(intent, approval, trustedKey, observedAt);
  requireCondition(instant(order.capture.create_time) <= instant(observedAt), 'Capture timestamp is in the future');
  const payload = {
    version: 'paypal-sandbox-receipt/v1', environment: 'sandbox', realMoney: false,
    evidenceMode: mode, providerAuthenticatedByThisReceipt: false,
    approvalProvenance: mode === 'offline-fixture' ? 'test-fixture' : 'caller-controlled-human-signing-boundary',
    intent: JSON.parse(canonical(intent)) as PurchaseIntent,
    approval: JSON.parse(canonical(approval)) as HumanApproval,
    intentDigest: intentDigest(intent), approvalDigest: digest(approval),
    order, captureResponse: result, observedAt, outcome: 'sandbox-capture-completed',
  };
  return {...payload, receiptDigest: digest(payload)};
}
/** The expected digest must be retained independently. Hashes alone do not attest PayPal or human identity. */
export function verifyReceipt(value: ReturnType<typeof createReceipt>, expectedDigest: string): boolean {
  try {
    const {receiptDigest, ...payload} = value;
    return /^[0-9a-f]{64}$/.test(expectedDigest) && receiptDigest === expectedDigest && digest(payload) === expectedDigest;
  } catch { return false; }
}
