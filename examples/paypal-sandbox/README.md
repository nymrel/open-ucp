# Human-authorized PayPal sandbox commerce

This is an additive PayPal adapter for the existing `open-ucp` product, using
its `ProductCatalog`. It does not change the core protocol, package exports,
Python protocol implementation, or x402/Nano/Stripe settlement behavior.
It has zero external runtime dependencies. All new source, example and test
files use the repository's MIT license. No sponsor imagery, customer data,
licensed media or third-party code is included in this example.

**Current evidence:** executable policy, reconciliation and transport-fixture
tests; a runnable offline fixture. Actual PayPal Developer access, a real
sandbox create/approve/capture round trip, and a local model invocation still
need verification. This is not a completed competition entry. An offline fixture
is not proof of either PayPal or AI integration functioning.

[Submission materials and evidence requirements](SUBMISSION.md) contain the
current draft description, AI disclosure, filming script and early-review plan.

## Reproduce the offline checks

Use Node 22 or 24 (the repository pins 24.20.0), with Corepack available:

```bash
corepack npm@12.0.2 ci
corepack npm@12.0.2 run verify
node --test test/paypal-sandbox-authorization.test.js
node examples/paypal-sandbox/demo.mjs --fixture
```

The last command runs entirely offline, generates a fixture signing key,
reconciles a synthetic order/capture and prints an `OFFLINE_FIXTURE` receipt.
It explicitly uses a scripted proposal, scripted approval and synthetic
provider responses. No credentials or account are needed. Denial tests mutate
merchant, item, quantity, currency, amount, expiry and evidence; they must fail.

## Run the actual integration after existing sandbox access is verified

1. Use the existing PayPal Developer account, its existing sandbox REST app,
   sandbox business merchant, and a separate existing sandbox buyer. Do not
   create a duplicate developer account. Confirm the dashboard is in **Sandbox**.
2. Obtain a short-lived access token for that sandbox app through the existing
   secure local credential workflow. Set `PAYPAL_SANDBOX_ACCESS_TOKEN` and
   `PAYPAL_SANDBOX_MERCHANT_ID` in that local process environment. Do not place
   tokens, client secrets, buyer passwords or real payment details in source,
   commands recorded on video, logs, receipts, chat, or the submission.
3. Run an existing local Ollama server on `127.0.0.1:11434`; set `OLLAMA_MODEL`
   to an already installed model you are authorized to use. The runner never
   downloads a model and does not call a paid AI service. Only synthetic catalog
   data is sent to the local model. Record the exact model/version and its license.
4. In an interactive terminal, run:

   ```bash
   node examples/paypal-sandbox/demo.mjs
   ```

The AI proposes only an allowed SKU and quantity. The adapter derives the price
and merchant independently. The terminal displays merchant, SKU, item, quantity,
exact amount, ceiling, currency, expiry, and the sandbox boundary. Enter the
displayed full `APPROVE <intent digest>` phrase to authorize that exact intent.
Any other response stops before PayPal. Automated/noninteractive approval is
refused.

The runner creates the sandbox order and displays a validated
`www.sandbox.paypal.com/checkoutnow` approval link. Approve it as the sandbox
buyer, return to the terminal and enter the displayed `CAPTURE <order ID>` phrase.
The adapter reads the APPROVED order, rechecks the scope and expiry, captures
only that order, fetches it again, then reconciles full order and capture evidence.
Neither `--fixture` nor a human intent signature replaces PayPal buyer approval.

This first example supports only USD digital goods, quantity 1–2, a $10 budget,
and a ten-minute intent. The underlying sandbox policy caps totals at $100,
quantity at 100, and lifetime at 15 minutes. It has no endpoint override, live
mode, payment-source entry, PATCH operation, or recurring-payment feature.

The runner reserves each intent atomically in
`~/.nymrel/paypal-sandbox-intents/` before network I/O. Reservations contain
only hashed identifiers, never credentials. Do not remove a reservation to
retry an unknown result. Inspect the existing sandbox dashboard and reconcile
the original order first. No automatic retry occurs after an uncertain response.
Create/capture also use distinct stable PayPal idempotency keys; these do not
replace the local reservation or provider reconciliation.

## Evidence and limits

Approval signatures cover the versioned intent digest and action/time using an
ephemeral Ed25519 key controlled by the terminal. The local AI never receives
the signer or token. This proves scope under the trusted terminal boundary;
it is not independent identity verification, a production authentication
system, or proof that a particular human clicked. Library consumers must supply
their own authenticated human UI, trusted public key and durable atomic
reservation. Never trust an approval key supplied by an AI or a request body.

Receipts bind the exact intent, approval, minimized observed order/capture,
evidence mode, observation time and outcome. Payer emails, addresses and tokens
are omitted. Keep the public approval key and receipt digest separately to
verify signatures/integrity. `verifyReceipt(receipt, expectedDigest)` detects
changes against an independently retained digest. A rewritten receipt and a
rewritten digest do not prove authenticity. PayPal responses are authenticated
by the direct TLS API call, not signed or independently attested by this receipt.
`providerAuthenticatedByThisReceipt` is always false.

To verify a saved run, retain its digest and the trusted terminal's public
approval key separately from the run JSON. Then use:

```bash
node examples/paypal-sandbox/verify-evidence.mjs RUN.json DIGEST.txt TRUSTED-KEY.pem
```

This offline command checks the retained hash, trusted key, approval signature,
intent scope, timestamps and capture reconciliation. It also rejects inconsistent
fixture labels. It never contacts PayPal or a model. Its `VERIFIED_OFFLINE`
result means verification ran offline, with the original `evidenceMode` retained;
it does not establish that PayPal or AI actually executed. Do not take the key
or expected digest from an untrusted run and call that independent verification.

The adapter rejects mismatches before create and before capture; mismatches or
missing evidence after capture prevent a success receipt and require manual
reconciliation. PayPal GET and capture are separate operations: another actor
with access to the sandbox app could modify an order between them. The adapter
cannot make PayPal's API atomic or undo a completed capture on an error. Use a
controlled sandbox app with no concurrent writer. This is not a production
spending authorization or settlement guarantee.

CREATED and APPROVED orders must have no `payments` field. Any evidence of
earlier captures, authorizations or refunds requires reconciliation and blocks
the capture request. This narrow flow supports one fresh complete capture.

## Competition completion checklist

Tracking issue: [portfolio-control #406](https://github.com/JalenBuildsHub/portfolio-control/issues/406).
Registration ID **3253913** is recorded there. Registration and final submission
remain separate milestones.

The [official rules](https://paypalaihackathon.devpost.com/rules), checked
October 28, 2026, set the cutoff at **November 12, 2026, noon PST / 20:00 UTC**.
They require meaningful PayPal sandbox plus AI use, functional access, public
open-source code with complete setup, and a public YouTube demonstration under
three minutes. Existing products need a significant update during the submission
period; the organizer decides whether that standard is met.

The organizer's [October 28 announcement](https://paypalaihackathon.devpost.com/updates/47305-two-weeks-to-go-get-your-project-checked-early)
offers early eligibility review for projects submitted by **Thursday, November 5**.
It gives no separate hour for that date. Editing remains possible until the
November 12 final deadline. A saved draft is not a submitted early-review entry.

- [ ] Verify existing PayPal Developer/sandbox access and the local AI model.
- [ ] Run the actual create → sandbox-buyer approve → capture → receipt journey.
- [ ] Run a clean-install reproduction and retain source revision, model identity,
      sanitized receipt/digest and actual check output. Exercise a denied intent.
- [ ] Review source, model/dependency licenses, ownership and publication rights.
      Confirm the entrant/representative's identity; the existing registration
      receipt flags a display-name/legal-name alignment to verify.
- [ ] Review and integrate the exact candidate through the existing source gates.
      Repository source visibility does not authorize a package release.
- [ ] Record actual working footage, under three minutes; inspect it for secrets,
      personal details, unauthorized logos/music and inaccurate claims.
- [ ] Obtain required release approval and publish the final video publicly on
      YouTube using the supported owner workflow.
- [ ] Reuse the existing Devpost account/project, fill the current submission form,
      disclose AI tools and the significant PayPal update, and preserve personal
      eligibility/rights/representation declarations and final rules acceptance.
- [ ] Submit only with the required approvals and retain the authentic Devpost
      confirmation. Do not label a draft, registration or saved project submitted.

Development assistance: ChatGPT/Codex. Runtime AI: local Ollama model selected
by the operator, not yet verified in this candidate. No sponsor tool is claimed.

## Filming outline (planned, not recorded)

0:00–0:20: explain the problem: an AI recommendation should not grant spending
authority. Show the synthetic catalog and local model's proposal.

0:20–0:50: show the exact merchant/item/price/expiry review and human approval.
Show that a changed or expired intent fails before the payment request.

0:50–1:50: show actual sandbox order creation, sandbox buyer approval and capture.
Keep credentials, developer dashboards and account details out of the frame.

1:50–2:30: show the minimized receipt, intent and approval bindings, outcome and
independently retained digest. Explain fixture versus actual sandbox evidence.

2:30–2:45: show the public source revision and reproducible instructions; disclose
the existing `open-ucp` baseline and new hackathon work. Leave margin below three minutes.

Primary API references: [create order](https://developer.paypal.com/api/orders/v2/orders-create),
[show order](https://developer.paypal.com/api/orders/v2/orders-get),
[capture](https://developer.paypal.com/api/orders/v2/orders-capture).
