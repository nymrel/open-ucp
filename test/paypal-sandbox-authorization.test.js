/** Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. All provider responses here are fixtures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { approvalPayload, authorize, createOrderPlan, intentDigest, money, instant } from '../dist/paypal-sandbox/authorization.js';
import { createReceipt, reconcileOrder, verifyReceipt } from '../dist/paypal-sandbox/receipt.js';
import { PayPalSandboxClient } from '../dist/paypal-sandbox/client.js';

const keys = generateKeyPairSync('ed25519');
const now = '2026-10-28T18:01:00.000Z';
export function fixture() {
  const intent = { version:'paypal-sandbox/v1', environment:'sandbox', intentId:'synthetic-intent-1',
    merchantId:'SYNTHETIC_MERCHANT', sku:'synthetic-notebook', name:'Synthetic notebook', quantity:2,
    currency:'USD', unitAmount:'4.00', exactAmount:'8.00', maxAmount:'10.00',
    issuedAt:'2026-10-28T18:00:00.000Z', expiresAt:'2026-10-28T18:10:00.000Z' };
  const unsigned = {version:'paypal-sandbox-approval/v1', action:'create-and-capture-exact-sandbox-order',
    intentDigest:intentDigest(intent), approvedAt:now};
  const approval = {...unsigned,signature:sign(null,Buffer.from(approvalPayload(unsigned)),keys.privateKey).toString('base64url')};
  const plan = createOrderPlan(intent,approval,keys.publicKey,now);
  const order = {id:'FIXTURE_ORDER', ...structuredClone(plan.body), status:'COMPLETED'};
  order.purchase_units[0].payments = {captures:[{id:'FIXTURE_CAPTURE', status:'COMPLETED', final_capture:true,
    amount:{currency_code:'USD',value:'8.00'},create_time:'2026-10-28T18:01:01Z'}]};
  const input = {intent,approval,trustedKey:keys.publicKey,order,captureResponse:structuredClone(order),
    observedAt:'2026-10-28T18:01:02.000Z',mode:'offline-fixture'};
  return {intent,approval,plan,order,input};
}
test('exact signed sandbox authorization produces a fixed host/request and deterministic receipt', () => {
  const {plan,input} = fixture();
  assert.equal(plan.url,'https://api-m.sandbox.paypal.com/v2/checkout/orders');
  assert.equal(plan.headers.Prefer,'return=representation');
  const receipt = createReceipt(input);
  assert.deepEqual(receipt,createReceipt(input));
  assert.equal(receipt.evidenceMode,'offline-fixture');
  assert.equal(receipt.approvalProvenance,'test-fixture');
  assert.equal(receipt.providerAuthenticatedByThisReceipt,false);
  assert.equal(receipt.realMoney,false);
  assert.equal(verifyReceipt(receipt,receipt.receiptDigest),true);
});
for (const [field,value] of Object.entries({merchantId:'OTHER',sku:'OTHER',name:'Changed',quantity:1,currency:'EUR',
  unitAmount:'3.00',exactAmount:'7.00',maxAmount:'11.00',expiresAt:'2026-10-28T18:11:00.000Z',
  intentId:'OTHER',environment:'live',version:'OTHER'})) {
  test(`changed intent ${field} cannot reuse approval`,()=>{
    const {intent,approval} = fixture();
    assert.throws(()=>authorize({...intent,[field]:value},approval,keys.publicKey,now));
  });
}
test('intent cannot smuggle endpoints or extra authority',()=>{
  const {intent,approval} = fixture();
  for (const extra of [{endpoint:'https://api-m.paypal.com'},{recurring:true},{budget:999}])
    assert.throws(()=>createOrderPlan({...intent,...extra},approval,keys.publicKey,now));
});
test('wrong key, modified action, malformed or noncanonical signatures fail closed',()=>{
  const {intent,approval} = fixture();
  assert.throws(()=>authorize(intent,approval,generateKeyPairSync('ed25519').publicKey,now));
  for (const signature of ['',approval.signature+'=',approval.signature.slice(0,-1)+'!', 'A'.repeat(86)])
    assert.throws(()=>authorize(intent,{...approval,signature},keys.publicKey,now));
  assert.throws(()=>authorize(intent,{...approval,action:'capture-anything'},keys.publicKey,now));
  assert.throws(()=>authorize(intent,{...approval,approvedAt:'2026-10-28T18:00:59Z'},keys.publicKey,now));
  assert.throws(()=>authorize(intent,{...approval,provenance:'human'},keys.publicKey,now));
});
test('expiry is exclusive and future approval/invalid dates are rejected',()=>{
  const {intent,approval} = fixture();
  for (const time of [intent.expiresAt,'2026-10-28T17:59:59Z','2026-02-30T18:00:00Z','not-a-date'])
    assert.throws(()=>authorize(intent,approval,keys.publicKey,time));
  assert.equal(instant('2026-10-28T18:00:00Z'),instant('2026-10-28T18:00:00.000Z'));
});
test('money rejects float coercion, exponent, signs, excess precision and huge values',()=>{
  for (const amount of [NaN,1,undefined,'1e2','-1.00','+1.00','1.001','01.00',' 1.00','999999999999999999999999.00'])
    assert.throws(()=>money(amount));
  for (const quantity of [0,-1,1.1,101,Number.MAX_SAFE_INTEGER,NaN]) {
    const {intent,approval} = fixture();
    assert.throws(()=>createOrderPlan({...intent,quantity},approval,keys.publicKey,now));
  }
});
const mutations = {
  merchant:o=>{o.purchase_units[0].payee.merchant_id='OTHER';},
  sku:o=>{o.purchase_units[0].items[0].sku='OTHER';},
  quantity:o=>{o.purchase_units[0].items[0].quantity='1';},
  title:o=>{o.purchase_units[0].items[0].name='OTHER';},
  currency:o=>{o.purchase_units[0].amount.currency_code='EUR';},
  total:o=>{o.purchase_units[0].amount.value='9.00';},
  missingItems:o=>{delete o.purchase_units[0].items;},
  extraItems:o=>{o.purchase_units[0].items.push({...o.purchase_units[0].items[0]});},
  extraUnits:o=>{o.purchase_units.push({...o.purchase_units[0]});},
  customId:o=>{o.purchase_units[0].custom_id='unbound';},
  missingMerchant:o=>{delete o.purchase_units[0].payee;},
  tax:o=>{o.purchase_units[0].amount.breakdown.tax_total={currency_code:'USD',value:'0.01'};},
  incomplete:o=>{o.status='APPROVED';},
  capturePending:o=>{o.purchase_units[0].payments.captures[0].status='PENDING';},
  captureAmount:o=>{o.purchase_units[0].payments.captures[0].amount.value='9.00';},
  captureCurrency:o=>{o.purchase_units[0].payments.captures[0].amount.currency_code='EUR';},
  notFinal:o=>{o.purchase_units[0].payments.captures[0].final_capture=false;},
  missingCapture:o=>{o.purchase_units[0].payments.captures=[];},
  extraCapture:o=>{o.purchase_units[0].payments.captures.push({...o.purchase_units[0].payments.captures[0]});},
  refunded:o=>{o.purchase_units[0].payments.refunds=[];},
  tooLate:o=>{o.purchase_units[0].payments.captures[0].create_time='2026-10-28T18:10:00Z';},
  tooEarly:o=>{o.purchase_units[0].payments.captures[0].create_time='2026-10-28T17:59:00Z';},
};
for (const [name,mutate] of Object.entries(mutations)) test(`receipt rejects observed ${name}`,()=>{
  const {input}=fixture(); mutate(input.order); mutate(input.captureResponse);
  assert.throws(()=>createReceipt(input));
});
test('capture response and independently fetched order must agree',()=>{
  const {input}=fixture(); input.captureResponse.id='DIFFERENT';
  assert.throws(()=>createReceipt(input));
});
test('PII, tokens and irrelevant provider fields are omitted from receipts',()=>{
  const {input}=fixture();
  for (const o of [input.order,input.captureResponse]) {
    o.payer={email_address:'synthetic@example.invalid'};o.access_token='SYNTHETIC_SECRET';
    o.purchase_units[0].shipping={address:'Synthetic address'};
  }
  const text=JSON.stringify(createReceipt(input));
  assert.ok(!text.includes('SYNTHETIC_SECRET')&&!text.includes('example.invalid')&&!text.includes('shipping'));
});
test('tampering or relabeling a fixture is detected against independently pinned hash',()=>{
  const {input}=fixture(); const receipt=createReceipt(input);const pinned=receipt.receiptDigest;
  receipt.evidenceMode='sandbox-api';assert.equal(verifyReceipt(receipt,pinned),false);
  receipt.receiptDigest='0'.repeat(64);assert.equal(verifyReceipt(receipt,pinned),false);
  assert.throws(()=>createReceipt({...input,mode:'authenticated-live'}));
});
test('a valid approval and body are required before CREATED/APPROVED order checks',()=>{
  const {intent,order}=fixture();order.status='APPROVED';
  delete order.purchase_units[0].payments;
  assert.equal(reconcileOrder(intent,order,'APPROVED').status,'APPROVED');
  delete order.purchase_units[0].items;assert.throws(()=>reconcileOrder(intent,order,'APPROVED'));
});

function lifecycle() {
  const f=fixture();f.order.id='FIXTUREORDER';f.input.captureResponse.id='FIXTUREORDER';
  const created=structuredClone(f.order);created.status='CREATED';delete created.purchase_units[0].payments;
  created.links=[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token=FIXTUREORDER'}];
  const approved=structuredClone(created);approved.status='APPROVED';
  const queue=[created,approved,structuredClone(f.order),structuredClone(f.order)];
  const calls=[]; const reservations=new Set();
  const options={accessToken:'SYNTHETIC_TOKEN',trustedApprovalKey:keys.publicKey,
    reserveIntent:async id=>{if(reservations.has(id))return false;reservations.add(id);return true;},
    clock:()=>f.input.observedAt,
    fixtureFetch:async (url,init)=>{calls.push({url,init});return new Response(JSON.stringify(queue.shift()),{status:200});}};
  return {...f,created,approved,queue,calls,options};
}
test('transport lifecycle validates approved/final orders and forbids replay',async()=>{
  const f=lifecycle(),client=new PayPalSandboxClient(f.options);
  const created=await client.create(f.intent,f.approval);
  assert.equal(created.approvalUrl,'https://www.sandbox.paypal.com/checkoutnow?token=FIXTUREORDER');
  const receipt=await client.capture();assert.equal(receipt.evidenceMode,'offline-fixture');
  assert.equal(client.state,'completed');assert.equal(f.calls.length,4);
  for(const {url,init} of f.calls){assert.ok(url.startsWith('https://api-m.sandbox.paypal.com/'));assert.equal(init.redirect,'error');}
  await assert.rejects(()=>client.capture());await assert.rejects(()=>client.create(f.intent,f.approval));
  const another=new PayPalSandboxClient(f.options);await assert.rejects(()=>another.create(f.intent,f.approval));
  assert.equal(f.calls.length,4);
});
for (const stage of ['created','approved']) for (const kind of ['captures','authorizations','refunds'])
  test(`${stage} order with prior ${kind} fails before capture POST`,async()=>{
    const f=lifecycle();
    f.queue[stage==='created'?0:1].purchase_units[0].payments={
      [kind]:[{id:'PRIORPAYMENT',status:'COMPLETED',amount:{currency_code:'USD',value:'8.00'}}],
    };
    const client=new PayPalSandboxClient(f.options);
    if(stage==='created') await assert.rejects(()=>client.create(f.intent,f.approval));
    else {await client.create(f.intent,f.approval);await assert.rejects(()=>client.capture());}
    assert.equal(client.state,'reconciliation-required');
    assert.equal(f.calls.length,stage==='created'?1:2);
    assert.ok(!f.calls.some(call=>call.url.endsWith('/capture')));
  });
test('invalid approvals fail before reservation or any network request',async()=>{
  const f=lifecycle();let reserved=false;f.options.reserveIntent=async()=>{reserved=true;return true;};
  const client=new PayPalSandboxClient(f.options);
  await assert.rejects(()=>client.create({...f.intent,merchantId:'OTHER'},f.approval));
  assert.equal(reserved,false);assert.equal(f.calls.length,0);
});
for(const [name,mutate] of Object.entries(mutations).filter(([name])=>['merchant','sku','quantity','currency','total','missingItems','extraItems','extraUnits','customId','tax'].includes(name)))
  test(`changed approved order ${name} blocks capture POST`,async()=>{
    const f=lifecycle();mutate(f.queue[1]);const client=new PayPalSandboxClient(f.options);
    await client.create(f.intent,f.approval);await assert.rejects(()=>client.capture());
    assert.equal(client.state,'reconciliation-required');assert.equal(f.calls.length,2);
  });
test('live endpoint overrides and approval redirects are rejected',async()=>{
  const f=lifecycle();assert.throws(()=>new PayPalSandboxClient({...f.options,endpoint:'https://api-m.paypal.com'}));
  f.queue[0].links[0].href='https://www.paypal.com/checkoutnow?token=FIXTUREORDER';
  const client=new PayPalSandboxClient(f.options);await assert.rejects(()=>client.create(f.intent,f.approval));
  assert.equal(client.state,'reconciliation-required');
});
test('caller mutation during reservation cannot change transmitted intent',async()=>{
  const f=lifecycle();f.options.reserveIntent=async()=>{f.intent.merchantId='ATTACKER';return true;};
  const client=new PayPalSandboxClient(f.options);await client.create(f.intent,f.approval);
  assert.equal(JSON.parse(f.calls[0].init.body).purchase_units[0].payee.merchant_id,'SYNTHETIC_MERCHANT');
});
test('unknown create outcome remains reserved and never retries or exposes token/provider errors',async()=>{
  const f=lifecycle();f.options.fixtureFetch=async()=>{throw new Error('SYNTHETIC_TOKEN provider private error');};
  const client=new PayPalSandboxClient(f.options);
  await assert.rejects(()=>client.create(f.intent,f.approval),error=>!error.message.includes('SYNTHETIC_TOKEN'));
  assert.equal(client.state,'reconciliation-required');await assert.rejects(()=>client.create(f.intent,f.approval));
});
test('expiry while fetching approval blocks capture POST',async()=>{
  const f=lifecycle();let time=f.input.observedAt;const original=f.options.fixtureFetch;
  f.options.clock=()=>time;f.options.fixtureFetch=async(url,init)=>{const r=await original(url,init);if(init.method==='GET')time=f.intent.expiresAt;return r;};
  const client=new PayPalSandboxClient(f.options);await client.create(f.intent,f.approval);
  await assert.rejects(()=>client.capture());assert.equal(f.calls.length,2);
});
const unsupportedInstructions = {
  platformFee: {platform_fees:[{amount:{currency_code:'USD',value:'1.00'},payee:{merchant_id:'OTHER'}}]},
  delayedDisbursement: {disbursement_mode:'DELAYED'},
  specialPricing: {payee_pricing_tier_id:'UNAPPROVED'},
  specialFx: {payee_receivable_fx_rate_id:'UNAPPROVED'},
};
for (const stage of ['created','approved','completed']) for (const [name,instruction] of Object.entries(unsupportedInstructions))
  test(`${stage} order rejects unapproved ${name} instructions`,async()=>{
    const f=lifecycle();
    if(stage==='completed') {
      for(const order of [f.input.order,f.input.captureResponse]) order.purchase_units[0].payment_instruction=instruction;
      assert.throws(()=>createReceipt(f.input));
    } else {
      f.queue[stage==='created'?0:1].purchase_units[0].payment_instruction=instruction;
      const client=new PayPalSandboxClient(f.options);
      if(stage==='created') await assert.rejects(()=>client.create(f.intent,f.approval));
      else {await client.create(f.intent,f.approval);await assert.rejects(()=>client.capture());}
      assert.equal(client.state,'reconciliation-required');
      assert.ok(!f.calls.some(call=>call.url.endsWith('/capture')));
    }
  });
for(const [name,mutate] of Object.entries({
  platformFee:c=>{c.seller_receivable_breakdown={platform_fees:[{amount:{currency_code:'USD',value:'1.00'}}]};},
  delayedDisbursement:c=>{c.disbursement_mode='DELAYED';},
})) test(`completed capture rejects unapproved ${name} evidence`,()=>{
  const f=lifecycle();
  for(const order of [f.input.order,f.input.captureResponse]) mutate(order.purchase_units[0].payments.captures[0]);
  assert.throws(()=>createReceipt(f.input));
});
test('provider default instant disbursement and ordinary processing fees remain compatible',async()=>{
  const f=lifecycle();
  for(const order of f.queue) {
    order.purchase_units[0].payment_instruction={disbursement_mode:'INSTANT'};
    const capture=order.purchase_units[0].payments?.captures[0];
    if(capture) {
      capture.disbursement_mode='INSTANT';
      capture.seller_receivable_breakdown={gross_amount:{currency_code:'USD',value:'8.00'},
        paypal_fee:{currency_code:'USD',value:'0.50'},net_amount:{currency_code:'USD',value:'7.50'}};
    }
  }
  const client=new PayPalSandboxClient(f.options);
  await client.create(f.intent,f.approval);
  assert.equal((await client.capture()).outcome,'sandbox-capture-completed');
});
test('runnable fixture demo reports fixture provenance and a verifiable receipt',()=>{
  const run=spawnSync(process.execPath,['examples/paypal-sandbox/demo.mjs','--fixture'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.status,'OFFLINE_FIXTURE');assert.equal(result.aiEvidence,'scripted-fixture');
  assert.equal(result.receipt.evidenceMode,'offline-fixture');
  assert.equal(verifyReceipt(result.receipt,result.receipt.receiptDigest),true);
  const bad=spawnSync(process.execPath,['examples/paypal-sandbox/demo.mjs','--live'],{encoding:'utf8'});
  assert.notEqual(bad.status,0);
  const noninteractive=spawnSync(process.execPath,['examples/paypal-sandbox/demo.mjs'],{encoding:'utf8'});
  assert.notEqual(noninteractive.status,0);assert.match(noninteractive.stderr,/human terminal/);
});
