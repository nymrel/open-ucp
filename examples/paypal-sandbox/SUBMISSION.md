# PayPal AI Hackathon submission materials

**Draft, October 29, 2026. Not a submitted entry or a completed sandbox demo.**
Continue the existing `open-ucp` application and [PR #23](https://github.com/nymrel/open-ucp/pull/23).
Do not create another project to work around unavailable account access.

## Entry fields prepared for the existing Devpost project

**Name:** open-ucp: Human-Authorized PayPal Commerce

**Tagline:** AI proposes. People authorize. PayPal sandbox verifies.

**Public source:** https://github.com/nymrel/open-ucp

**Candidate source:** https://github.com/nymrel/open-ucp/tree/feat/paypal-sandbox-authorization-20261028

**Run instructions:** [README](README.md). Until PR #23 is integrated, judges must
explicitly check out its branch or the exact verified candidate SHA; default
`main` does not contain this example. The application is a Node terminal demo.

**Video:** pending actual runtime footage and public YouTube publication.

**Built With:** TypeScript, Node.js, PayPal Orders v2 sandbox API, Ed25519,
SHA-256, Ollama (runtime integration implemented; execution still unverified).
Replace the Ollama qualification with the actual model name, immutable model
digest, runtime version and license only after a genuine model run.

### Inspiration

An AI recommendation should give a person a useful choice with a precise
approval boundary. We extended Nymrel's existing open-ucp commerce product so a
model can propose a synthetic purchase while the person retains control over
the merchant, item, quantity, exact price, currency and expiration.

### What it does

The model proposes a SKU and quantity from a synthetic catalog. Trusted
application code derives the price and constructs a sandbox-only purchase
intent. A person reviews that exact intent and types its approval digest.
The local terminal signs the approval; the model never receives the signing
key or PayPal token.

The adapter reserves the intent before network access, creates a PayPal sandbox
order and presents the sandbox-buyer approval link. After separate buyer
approval, it checks the order again before capture. It then reconciles the
capture response with independently fetched order details and produces a
minimized, hash-bound receipt. Any scope mismatch blocks success. An offline
verifier can recheck receipt integrity, approval signatures and reconciliation
against a separately retained digest and trusted public key.

### Significant update during the hackathon

open-ucp existed before this event. The October 28 candidate adds six original
PayPal-specific files: exact signed authorization, a fixed sandbox transport,
replay reservations, pre-capture and post-capture verification, a runnable
Ollama/terminal example, documentation and adversarial tests. The October 29
continuation rejects pre-existing payment evidence before capture and adds the
saved-evidence verifier and submission materials. These are additions to the
existing product. No new core protocol or new application is claimed.
The further source review adds rejection of unapproved platform-fee, special
pricing/FX and delayed-disbursement instructions in observed order/capture
evidence. Ordinary provider processing fees and default instant disbursement
remain permitted. Fourteen adversarial response cases reproduced the missing
rejection before the fix; these are fixture tests, not a demonstrated provider
vulnerability.

### Current evidence and limits

Locked Node installation, automated authorization/transport-fixture tests and
offline fixture execution have been reproduced. The original October 28 head
has 17 successful hosted checks. Fresh check results for a later head must be
reported separately.

**Still pending:** authenticated PayPal Developer access; a genuine sandbox
create/buyer-approve/capture/reconciliation run; actual model inference;
recorded runtime model identity/license; working footage; public YouTube URL;
authenticated Devpost project inspection; entrant declarations and a submission
receipt. Fixture success proves neither PayPal execution nor model execution.

This is a sandbox proof of concept. The signature proves scope under the
trusted-terminal boundary, not a person's independently verified identity.
The receipt does not provide PayPal attestation. PayPal GET and capture are
separate operations; the adapter cannot prevent a concurrent external order
mutation or undo a completed capture. Use a controlled sandbox app without a
concurrent writer. An inconsistent or uncertain outcome requires reconciliation.

### AI and third-party disclosure

Development assistance: ChatGPT/Codex for implementation, tests, review and
documentation. Runtime integration: local Ollama, limited to SKU/quantity
selection from synthetic data; no genuine inference has been observed in this
candidate. Do not describe the scripted fixture as AI output. No paid model
call, sponsor-tool integration, model-training claim or sponsor endorsement is
asserted. When inference is verified, record the actual model, model digest,
Ollama version, model license and captured proposal in the evidence record.

Code and synthetic catalog: Nymrel / JalenBuilds LLC, repository MIT license.
No external runtime dependencies are added. Do not imply ownership of PayPal,
Ollama, a third-party model or the pre-existing upstream dependencies. Preserve
their terms and model/dependency notices. Public source does not establish the
entrant's personal eligibility or authority to represent an organization.

## Genuine-run evidence to retain

1. Exact Git SHA and clean working-tree status; Node/npm versions; locked-install
   and check output; dependency/license review.
2. Actual Ollama version, installed model name and digest, model license, prompt
   and returned synthetic SKU/quantity. No scripted substitution.
3. The displayed intent and its digest; the person's exact approval action;
   the trusted terminal's public key retained separately. Never retain the
   private key, token, buyer password or payment credentials in the evidence.
4. Sandbox order ID; genuine buyer approval; actual order/capture statuses;
   sanitized receipt; separately retained receipt digest; offline verifier output.
   Inspect the existing sandbox dashboard to reconcile provider IDs and amount.
5. A changed or expired intent denied before any payment request. Automated
   denial tests and human walkthrough evidence must be labeled separately.
6. Authentic Devpost project ID/URL, saved-field state, actual submission
   confirmation/time and later eligibility-review feedback. Registration ID
   3253913 is registration evidence only. Never invent a submission receipt.

Keep raw provider responses and dashboards private: they can contain payer
information. Share only a deliberately sanitized evidence record. Review footage
frame by frame for credentials, personal details and unrelated browser tabs.

## Filming script: target 2 minutes 45 seconds

Record only after the actual sandbox and model journey works. This script is
planned copy, not a transcript of a completed run. Use the exact model identity
and real sandbox statuses seen during filming.

| Time | Footage | Narration |
| --- | --- | --- |
| 0:00–0:20 | Synthetic catalog and actual model proposal | “This is Nymrel's human-authorized PayPal commerce example in open-ucp. The local model proposes two fictional notebooks. It can propose a purchase, while trusted code controls the price and the person controls authorization.” |
| 0:20–0:50 | Exact intent and human approval | “Here are the merchant, item, quantity, eight-dollar total and expiration. The person approves this exact digest. Changing the item, amount or expiry invalidates that approval.” |
| 0:50–1:40 | Actual sandbox create, buyer approval and capture | “This order is created using PayPal's free sandbox. The buyer separately approves it in the sandbox checkout. We check the approved order before capture, then reconcile the completed capture with a fresh order read.” |
| 1:40–2:15 | Sanitized receipt and verifier | “The receipt binds the intent, approval and minimized order evidence. This offline verifier checks its retained digest and approval key. It does not independently attest PayPal or identify the human.” |
| 2:15–2:35 | Actual denial evidence and limitations | “A changed intent is rejected. This is a controlled sandbox example with one fresh capture; it is not production spending authorization. Unknown outcomes need reconciliation.” |
| 2:35–2:45 | Public source and setup instructions | “We extended our existing MIT-licensed open-ucp product during the hackathon. Source and reproducible setup are public. ChatGPT/Codex assisted development; runtime selection uses the model shown in this recording.” |

Use no music or sponsor graphics. Do not manufacture checkout footage, model
output, approval actions, receipts, organizer feedback or a successful upload.

## Early eligibility review and final entry

The organizer's [October 28 update](https://paypalaihackathon.devpost.com/updates/47305-two-weeks-to-go-get-your-project-checked-early)
offers review for submissions by Thursday, November 5. No separate hour was
stated. The [official deadline](https://paypalaihackathon.devpost.com/rules)
is Thursday, November 12, 2026, noon PST / 20:00 UTC. The early-review opportunity
does not remove working-demo, source, video, rights or entrant requirements.

After restoring authenticated Devpost access, inspect the existing project and
the live submission form. Map these prepared fields to that form, retain any
existing content and use the actual public video URL. Leave personal eligibility,
legal name/organization representation, rights declarations and rules acceptance
to the entrant as required. Do not invent factual answers. Final submission must
produce an authentic confirmation before the entry is called submitted.
