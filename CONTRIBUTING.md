# Contributing to open-ucp

Thank you for your interest in contributing to the Universal Commerce Protocol (UCP) reference implementation!

## Architectural Principles

1. **Zero External Runtime Dependencies:** Both the TypeScript/Node.js package (`@nymrel/open-ucp`) and the Python package (`open_ucp`) must strictly maintain zero external runtime dependencies. Use standard library capabilities (`node:crypto`, `node:http`, `node:fs`, Python `hashlib`, `hmac`, `urllib`, `dataclasses`).
2. **TypeScript & Python Parity:** Any core protocol addition (e.g. negotiation algorithms, validator rules, payment header structures) must be implemented with 1:1 parity in both TypeScript and Python.
3. **Dual-Audience Machine Trust:** Ensure all schemas maintain Schema.org JSON-LD alignment, machine readability, and entity verification compliance.
4. **100% Green Validation:** All PRs must pass the exact Node, Python, packaging, audit, and CI-contract commands below.

## Development Workflow

### TypeScript / Node.js
```bash
corepack npm@12.0.2 ci
corepack npm@12.0.2 run verify
corepack npm@12.0.2 audit --audit-level=high
corepack npm@12.0.2 audit --omit=dev --audit-level=high
corepack npm@12.0.2 install-scripts ls
```

### Python
```bash
python -m pip install --requirement requirements-dev.txt
python -m pip install --editable ".[fastapi]"
python -m pip check
python -m ruff check python
python -m bandit -q -r python/open_ucp
python -m unittest discover -s python/tests -p "test_*.py" -v
python -m pip uninstall --yes open-ucp
python -m pip_audit --strict
python -m build --outdir dist-py
python -m twine check dist-py/*
```

The supported runtime lines are Node 22/24 and Python 3.11–3.14. The editable first-party package is removed only after tests so the strict audit can evaluate every resolved third-party dependency without treating the unpublished local distribution as an unauditable PyPI package. Do not bypass a failed locked Node install, pinned Python toolchain, audit, or packaging check with a fallback installer or warning-only shell clause.

## Pull Request Guidelines

1. Fork the repository and create a feature branch (`git checkout -b feature/my-feature`).
2. Implement your changes adhering to zero runtime dependencies.
3. Add automated tests covering the new functionality in both `test/` (Node.js) and `python/tests/` (Python).
4. Verify that all tests pass.
5. Submit a Pull Request with a clear summary of the changes, rationale, and validation output.

Publication remains separate from pull-request validation. A matching `v<package-version>` tag may start the tag-only release workflow, but npm/PyPI trusted-publisher configuration and protected `npm`/`pypi` environments remain operator-controlled external gates.
