/** Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. Synthetic offline evidence only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../dist/paypal-sandbox/authorization.js';
import { verifyEvidence } from '../examples/paypal-sandbox/verify-evidence.mjs';

function sample() {
  const run = spawnSync(process.execPath,['examples/paypal-sandbox/demo.mjs','--fixture'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  return JSON.parse(run.stdout);
}
function rehash(receipt) {
  const {receiptDigest,...payload} = receipt;
  receipt.receiptDigest = digest(payload);
  return receipt.receiptDigest;
}
test('offline evidence checks independent digest, signature and reconciled receipt',()=>{
  const run=sample();
  const result=verifyEvidence(run,run.receipt.receiptDigest,run.approvalPublicKey);
  assert.equal(result.evidenceMode,'offline-fixture');
  assert.equal(result.approvalSignatureValid,true);
  assert.equal(result.providerIndependentlyVerified,false);
  assert.equal(result.modelExecutionIndependentlyVerified,false);
});
test('receipt cannot substitute a self-supplied key or changed digest',()=>{
  const run=sample();
  const wrong=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  assert.throws(()=>verifyEvidence(run,run.receipt.receiptDigest,wrong));
  assert.throws(()=>verifyEvidence(run,'0'.repeat(64),run.approvalPublicKey));
});
test('recomputed hash does not conceal invalid approval or receipt semantics',()=>{
  for (const mutate of [
    r=>{r.approval.signature='A'.repeat(86);},
    r=>{r.order.capture.amount.value='9.00';},
    r=>{r.realMoney=true;},
    r=>{r.providerAuthenticatedByThisReceipt=true;},
    r=>{r.outcome='live-settlement';},
  ]) {
    const run=sample();mutate(run.receipt);
    assert.throws(()=>verifyEvidence(run,rehash(run.receipt),run.approvalPublicKey));
  }
});
test('fixture model claims and inconsistent evidence labels are rejected',()=>{
  const run=sample();run.status='SANDBOX_API';
  assert.throws(()=>verifyEvidence(run,run.receipt.receiptDigest,run.approvalPublicKey));
  run.status='OFFLINE_FIXTURE';run.aiEvidence={provider:'local-ollama',model:'not-called'};
  assert.throws(()=>verifyEvidence(run,run.receipt.receiptDigest,run.approvalPublicKey));
});
test('CLI verifies a saved fixture and fails safely for tampered evidence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'paypal-evidence-'));
  try {
    const run=sample(),paths=['run.json','digest.txt','key.pem'].map(name=>join(dir,name));
    await writeFile(paths[0],JSON.stringify(run));await writeFile(paths[1],run.receipt.receiptDigest);
    await writeFile(paths[2],run.approvalPublicKey);
    const good=spawnSync(process.execPath,['examples/paypal-sandbox/verify-evidence.mjs',...paths],{encoding:'utf8'});
    assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).status,'VERIFIED_OFFLINE');
    await writeFile(paths[0],'PRIVATE_CANARY');
    const bad=spawnSync(process.execPath,['examples/paypal-sandbox/verify-evidence.mjs',...paths],{encoding:'utf8'});
    assert.notEqual(bad.status,0);assert.ok(!bad.stderr.includes('PRIVATE_CANARY'));
  } finally {await rm(dir,{recursive:true,force:true});}
});
