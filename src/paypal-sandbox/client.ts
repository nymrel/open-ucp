/** Fixed-host sandbox transport. Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. */
import type { KeyObject } from 'node:crypto';
import { authorize, createOrderPlan, digest, exactKeys, intentDigest, record, requireCondition, SANDBOX_ORIGIN, type HumanApproval, type PurchaseIntent } from './authorization.js';
import { createReceipt, reconcileOrder } from './receipt.js';

export interface SandboxClientOptions {
  accessToken: string;
  trustedApprovalKey: KeyObject | string;
  /** Persist an atomic reservation keyed by intentId BEFORE network I/O. Never clear on an ambiguous result. */
  reserveIntent: (intentId: string) => Promise<boolean>;
  clock?: () => string;
  /** Test seam only. Injected responses are fixtures, not authenticated provider evidence. */
  fixtureFetch?: typeof fetch;
}
/** One intent, one create attempt, one capture attempt; errors require reconciliation, never blind retries. */
export class PayPalSandboxClient {
  #options: SandboxClientOptions;
  #intent?: PurchaseIntent;
  #approval?: HumanApproval;
  #orderId?: string;
  #state: 'new' | 'creating' | 'awaiting-buyer' | 'capturing' | 'completed' | 'reconciliation-required' = 'new';

  constructor(options: SandboxClientOptions) {
    const keys = ['accessToken', 'trustedApprovalKey', 'reserveIntent'];
    if ('clock' in options) keys.push('clock');
    if ('fixtureFetch' in options) keys.push('fixtureFetch');
    exactKeys(options, keys); // No endpoint override or live-mode flag exists.
    requireCondition(typeof options.accessToken === 'string' && options.accessToken.length > 0 && !/[\r\n]/.test(options.accessToken), 'Sandbox access token required');
    requireCondition(typeof options.reserveIntent === 'function', 'Atomic intent reservation required');
    this.#options = {...options};
  }
  get state(): string { return this.#state; }
  #now(): string { return this.#options.clock?.() ?? new Date().toISOString(); }
  async #request(path: string, method: string, body?: unknown, requestId?: string): Promise<unknown> {
    requireCondition(/^\/v2\/checkout\/orders(?:\/[A-Z0-9]{1,36}(?:\/capture)?)?$/.test(path), 'Unsupported sandbox operation');
    const transport = this.#options.fixtureFetch ?? fetch;
    try {
      const response = await transport(SANDBOX_ORIGIN + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: {Authorization: 'Bearer ' + this.#options.accessToken, 'Content-Type': 'application/json',
          Prefer: 'return=representation', ...(requestId ? {'PayPal-Request-Id':requestId} : {})},
        ...(body === undefined ? {} : {body:JSON.stringify(body)}),
      });
      requireCondition(response.ok, 'PayPal sandbox request failed; inspect the sandbox dashboard before retrying');
      // Never include provider error bodies, payer data or tokens in errors/logs.
      const text = await response.text();
      requireCondition(text.length < 256_000, 'Oversized sandbox response');
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('Sandbox request failed or result is unknown; reconciliation required');
    }
  }
  async create(intent: PurchaseIntent, approval: HumanApproval): Promise<{orderId:string; approvalUrl:string}> {
    requireCondition(this.#state === 'new', 'Intent already attempted; do not retry blindly');
    // Snapshot before the first await, so caller mutation cannot widen approved scope.
    const i = structuredClone(intent), a = structuredClone(approval);
    const plan = createOrderPlan(i, a, this.#options.trustedApprovalKey, this.#now());
    this.#state = 'creating';
    try {
      requireCondition(await this.#options.reserveIntent(i.intentId), 'Intent already reserved');
      authorize(i, a, this.#options.trustedApprovalKey, this.#now());
      this.#intent = i; this.#approval = a;
      const raw = record(await this.#request('/v2/checkout/orders', 'POST', plan.body, plan.headers['PayPal-Request-Id']));
      const order = reconcileOrder(i, raw, 'CREATED');
      requireCondition(/^[A-Z0-9]{1,36}$/.test(order.id), 'Invalid PayPal order ID');
      requireCondition(Array.isArray(raw.links), 'Missing sandbox buyer approval URL');
      const links = raw.links.map(record).filter(link => link.rel === 'approve');
      requireCondition(links.length === 1 && typeof links[0]?.href === 'string', 'Ambiguous buyer approval URL');
      const url = new URL(links[0].href);
      requireCondition(url.origin === 'https://www.sandbox.paypal.com' && url.pathname === '/checkoutnow' &&
        url.searchParams.get('token') === order.id && !url.username && !url.password, 'Unsafe buyer approval URL');
      // Do not forward unrecognized query parameters from a provider response.
      this.#orderId = order.id; this.#state = 'awaiting-buyer';
      return {orderId:order.id, approvalUrl:'https://www.sandbox.paypal.com/checkoutnow?token=' + order.id};
    } catch (error) { this.#state = 'reconciliation-required'; throw error; }
  }
  async capture(): Promise<ReturnType<typeof createReceipt>> {
    requireCondition(this.#state === 'awaiting-buyer' && this.#intent && this.#approval && this.#orderId, 'No order awaiting buyer approval');
    const i = this.#intent, a = this.#approval, id = this.#orderId;
    this.#state = 'capturing';
    try {
      authorize(i, a, this.#options.trustedApprovalKey, this.#now());
      const before = reconcileOrder(i, await this.#request('/v2/checkout/orders/' + id, 'GET'), 'APPROVED');
      requireCondition(before.id === id, 'Order ID mismatch');
      authorize(i, a, this.#options.trustedApprovalKey, this.#now());
      const captured = await this.#request('/v2/checkout/orders/' + id + '/capture', 'POST', {}, digest({capture:intentDigest(i)}).slice(0,32));
      const after = await this.#request('/v2/checkout/orders/' + id, 'GET');
      requireCondition(record(captured).id === id && record(after).id === id, 'Captured order ID mismatch');
      const receipt = createReceipt({intent:i, approval:a, trustedKey:this.#options.trustedApprovalKey,
        order:after, captureResponse:captured, observedAt:this.#now(),
        mode:this.#options.fixtureFetch ? 'offline-fixture' : 'sandbox-api'});
      this.#state = 'completed'; return receipt;
    } catch (error) { this.#state = 'reconciliation-required'; throw error; }
  }
}
