/** Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. Synthetic catalog; sandbox only. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ProductCatalog } from '../../dist/core/catalog.js';
import { approvalPayload, createOrderPlan, digest, exactKeys, intentDigest, requireCondition } from '../../dist/paypal-sandbox/authorization.js';
import { createReceipt, verifyReceipt } from '../../dist/paypal-sandbox/receipt.js';
import { PayPalSandboxClient } from '../../dist/paypal-sandbox/client.js';

const isFixture=process.argv.length===3&&process.argv[2]==='--fixture';
requireCondition(isFixture||process.argv.length===2,'Usage: node examples/paypal-sandbox/demo.mjs [--fixture]');
const catalog=new ProductCatalog([{sku:'synthetic-notebook',title:'Synthetic notebook',description:'A fictional digital notebook for sandbox tests.',
  basePrice:4,currency:'USD',unit:'item',stockStatus:'in_stock'}]);
const keys=generateKeyPairSync('ed25519');
const at=isFixture?'2026-10-28T18:00:00.000Z':new Date().toISOString();
let proposal;
if(isFixture){proposal={sku:'synthetic-notebook',quantity:2};}
else {
  requireCondition(process.stdin.isTTY&&process.stdout.isTTY,'A human terminal is required; automatic approval is unavailable');
  requireCondition(process.env.PAYPAL_SANDBOX_ACCESS_TOKEN&&process.env.PAYPAL_SANDBOX_MERCHANT_ID,'Set existing sandbox access in the local environment; never paste credentials into chat');
  const model=process.env.OLLAMA_MODEL;
  requireCondition(typeof model==='string'&&/^[A-Za-z0-9_./:-]{1,100}$/.test(model),'Set OLLAMA_MODEL to an already installed local model');
  console.error('Preparing a proposal with your local AI model. No payment authority is sent to the model.');
  const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60_000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,format:'json',
      prompt:'Choose two synthetic notebooks from this catalog for a sandbox purchase. Return only JSON with sku and integer quantity (1 or 2). Catalog: '+JSON.stringify(catalog.getAllProducts().map(p=>({sku:p.sku,name:p.title,currency:p.currency,unitAmount:'4.00'})))})});
  requireCondition(response.ok,'Local model failed; no purchase created');
  const result=await response.json();requireCondition(typeof result.response==='string'&&result.response.length<=4096,'Invalid model result');
  proposal=JSON.parse(result.response);
}
exactKeys(proposal,['sku','quantity']);
requireCondition(proposal.sku==='synthetic-notebook'&&Number.isInteger(proposal.quantity)&&proposal.quantity>=1&&proposal.quantity<=2,'Model proposal violates catalog policy');
const product=catalog.getProduct(proposal.sku);
const intent={version:'paypal-sandbox/v1',environment:'sandbox',intentId:isFixture?'synthetic-fixture':randomUUID(),
  merchantId:isFixture?'SYNTHETIC_MERCHANT':process.env.PAYPAL_SANDBOX_MERCHANT_ID,
  sku:product.sku,name:product.title,quantity:proposal.quantity,currency:'USD',unitAmount:'4.00',
  exactAmount:proposal.quantity===2?'8.00':'4.00',maxAmount:'10.00',issuedAt:at,
  expiresAt:new Date(Date.parse(at)+10*60_000).toISOString()};
const hash=intentDigest(intent);
let terminal;
if(!isFixture){
  terminal=createInterface({input:process.stdin,output:process.stderr});
  console.error(JSON.stringify({merchant:intent.merchantId,item:intent.name,sku:intent.sku,quantity:intent.quantity,
    exactAmount:intent.exactAmount,maxAmount:intent.maxAmount,currency:intent.currency,expiresAt:intent.expiresAt,environment:'FREE SANDBOX — NO REAL MONEY'},null,2));
  const answer=await terminal.question('To authorize only this transaction, type APPROVE '+hash+': ');
  if(answer!=='APPROVE '+hash){terminal.close();throw new Error('Purchase denied; no PayPal request made');}
}
const unsigned={version:'paypal-sandbox-approval/v1',action:'create-and-capture-exact-sandbox-order',intentDigest:hash,
  approvedAt:isFixture?at:new Date().toISOString()};
const approval={...unsigned,signature:sign(null,Buffer.from(approvalPayload(unsigned)),keys.privateKey).toString('base64url')};
let receipt;
if(isFixture){
  console.error('OFFLINE FIXTURE: scripted proposal, fixture approval, synthetic PayPal responses. No AI model or PayPal API was called.');
  const plan=createOrderPlan(intent,approval,keys.publicKey,at);
  const order={...structuredClone(plan.body),id:'FIXTUREORDER',status:'COMPLETED'};
  order.purchase_units[0].payments={captures:[{id:'FIXTURECAPTURE',status:'COMPLETED',final_capture:true,
    amount:{currency_code:'USD',value:intent.exactAmount},create_time:at}]};
  receipt=createReceipt({intent,approval,trustedKey:keys.publicKey,order,captureResponse:structuredClone(order),observedAt:at,mode:'offline-fixture'});
} else {
  const directory=join(homedir(),'.nymrel','paypal-sandbox-intents');
  const client=new PayPalSandboxClient({accessToken:process.env.PAYPAL_SANDBOX_ACCESS_TOKEN,trustedApprovalKey:keys.publicKey,
    reserveIntent:async id=>{await mkdir(directory,{recursive:true,mode:0o700});try{await mkdir(join(directory,digest(id)),{mode:0o700});return true;}
      catch(error){if(error.code==='EEXIST')return false;throw error;}}});
  try {
    const created=await client.create(intent,approval);
    console.error('Approve with an existing SANDBOX buyer account: '+created.approvalUrl);
    const answer=await terminal.question('After sandbox buyer approval, type CAPTURE '+created.orderId+': ');
    requireCondition(answer==='CAPTURE '+created.orderId,'Capture cancelled; no capture request made');
    receipt=await client.capture();
  } finally {terminal.close();}
}
requireCondition(verifyReceipt(receipt,receipt.receiptDigest),'Receipt integrity failure');
console.log(JSON.stringify({status:isFixture?'OFFLINE_FIXTURE':'SANDBOX_API',
  aiEvidence:isFixture?'scripted-fixture':{provider:'local-ollama',model:process.env.OLLAMA_MODEL},
  approvalPublicKey:keys.publicKey.export({type:'spki',format:'pem'}),receipt},null,2));
