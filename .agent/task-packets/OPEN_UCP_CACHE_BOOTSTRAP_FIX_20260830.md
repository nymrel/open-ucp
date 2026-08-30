# Open UCP cache-bootstrap repair

Date: 2026-08-30
Owner: Codex
Claim: `codex-open-ucp-cache-bootstrap-fix-20260830`
Base: `1cfe6597e556f421aef0642fadd3689b8163ec8d`

## Mission

Repair the hosted Open UCP Node CI bootstrap failure without weakening the
exact npm 12.0.2 package-manager contract or adopting unrelated product and
dependency work.

## Evidence and root cause

Hosted run `33286790612` failed all four Node 22/24 Ubuntu/Windows jobs inside
`actions/setup-node`. Its `cache: npm` probe invoked runner npm 11 before pinned
npm 12.0.2 was active, so strict `devEngines` returned `EBADDEVENGINES`.
Python 3.11-3.14, Python packaging, workflow security, and CodeQL passed.

## Bounded change

- Disable setup-node's explicit and implicit package-manager cache bootstrap.
- Retain every locked install, verification, audit, install-script, and package
  inspection command on `corepack npm@12.0.2`.
- Add a deterministic ordering and cache regression contract.
- Preserve the dirty primary checkout's CLI, catalog, manifest, and `.agent`
  bytes exactly.
- Do not modify or adopt Dependabot PR #2.

## Acceptance

- Full local Node protocol/package contract and audits pass.
- actionlint, workflow parsing, and focused zizmor pass.
- The exact commit receives independent read-only acceptance.
- Hosted provider-admitted CI proves Ubuntu/Windows Node 22/24.

## Honest gates

This lane does not merge dependency updates, publish npm or PyPI packages,
create trusted publishers, tag a release, deploy a service, or claim adoption,
customers, commerce transactions, or revenue.
