/** Copyright (c) 2026 Nymrel / JalenBuilds LLC. MIT. Offline verification only. */
import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { canonical, exactKeys, requireCondition } from '../../dist/paypal-sandbox/authorization.js';
import { createReceipt, verifyReceipt } from '../../dist/paypal-sandbox/receipt.js';

/** The digest and key must come from separately retained, trusted records. */
export function verifyEvidence(evidence, expectedDigest, trustedPublicKey) {
  exactKeys(evidence, ['status', 'aiEvidence', 'approvalPublicKey', 'receipt']);
  const receipt = evidence.receipt;
  requireCondition(verifyReceipt(receipt, expectedDigest), 'Receipt differs from independently retained digest');
  const trusted = createPublicKey(trustedPublicKey);
  const embedded = createPublicKey(evidence.approvalPublicKey);
  requireCondition(trusted.export({type:'spki',format:'pem'}) === embedded.export({type:'spki',format:'pem'}), 'Approval key differs from trusted record');
  const fixture = receipt.evidenceMode === 'offline-fixture';
  requireCondition(evidence.status === (fixture ? 'OFFLINE_FIXTURE' : 'SANDBOX_API'), 'Evidence status/mode mismatch');
  if(fixture) requireCondition(evidence.aiEvidence === 'scripted-fixture', 'Fixture cannot claim model execution');
  else {
    exactKeys(evidence.aiEvidence, ['provider', 'model']);
    requireCondition(evidence.aiEvidence.provider === 'local-ollama' &&
      typeof evidence.aiEvidence.model === 'string' && /^[A-Za-z0-9_./:-]{1,100}$/.test(evidence.aiEvidence.model), 'Invalid model disclosure');
  }
  function restore(normalized) {
    const raw = structuredClone(normalized);
    raw.purchase_units[0].payments = {captures:[raw.capture]};
    delete raw.capture;
    return raw;
  }
  // Recheck exact scope, signature, expiry and capture reconciliation as well as
  // the hash. Use recorded observation time, rather than today's wall clock.
  const rebuilt = createReceipt({intent:receipt.intent, approval:receipt.approval,
    trustedKey:trusted, order:restore(receipt.order), captureResponse:restore(receipt.captureResponse),
    observedAt:receipt.observedAt, mode:receipt.evidenceMode});
  requireCondition(canonical(rebuilt) === canonical(receipt), 'Receipt semantics differ from reconciled evidence');
  return {status:'VERIFIED_OFFLINE', evidenceMode:receipt.evidenceMode,
    approvalSignatureValid:true, receiptDigest:expectedDigest,
    providerIndependentlyVerified:false, modelExecutionIndependentlyVerified:false};
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireCondition(process.argv.length === 5, 'Usage: node examples/paypal-sandbox/verify-evidence.mjs RUN.json DIGEST.txt TRUSTED-KEY.pem');
    async function bounded(path, limit) {
      const bytes = await readFile(path);
      requireCondition(bytes.length <= limit, 'Evidence file too large');
      return bytes.toString('utf8');
    }
    const run = JSON.parse(await bounded(process.argv[2], 256_000));
    const pinned = (await bounded(process.argv[3], 100)).trim();
    const key = await bounded(process.argv[4], 4096);
    console.log(JSON.stringify(verifyEvidence(run,pinned,key),null,2));
  } catch {
    // Never echo untrusted file contents or parser/provider diagnostics.
    console.error('Evidence verification failed. Check the saved run, independent digest and trusted public key.');
    process.exitCode = 1;
  }
}
