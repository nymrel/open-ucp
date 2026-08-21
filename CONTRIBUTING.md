# Contributing to open-ucp

Thank you for your interest in contributing to the Universal Commerce Protocol (UCP) reference implementation!

## Architectural Principles

1. **Zero External Runtime Dependencies:** Both the TypeScript/Node.js package (`@nymrel/open-ucp`) and the Python package (`open_ucp`) must strictly maintain zero external runtime dependencies. Use standard library capabilities (`node:crypto`, `node:http`, `node:fs`, Python `hashlib`, `hmac`, `urllib`, `dataclasses`).
2. **TypeScript & Python Parity:** Any core protocol addition (e.g. negotiation algorithms, validator rules, payment header structures) must be implemented with 1:1 parity in both TypeScript and Python.
3. **Dual-Audience Machine Trust:** Ensure all schemas maintain Schema.org JSON-LD alignment, machine readability, and entity verification compliance.
4. **100% Green Validation:** All PRs must pass `npm test`, `npm run typecheck`, and `python -m unittest discover`.

## Development Workflow

### TypeScript / Node.js
```bash
# Install development dependencies
npm install

# Compile TypeScript
npm run build

# Run Typecheck
npm run typecheck

# Run Node.js unit tests
npm test
```

### Python
```bash
# Run Python unit tests
python -m unittest discover -s python/tests -p "test_*.py" -v
```

## Pull Request Guidelines

1. Fork the repository and create a feature branch (`git checkout -b feature/my-feature`).
2. Implement your changes adhering to zero runtime dependencies.
3. Add automated tests covering the new functionality in both `test/` (Node.js) and `python/tests/` (Python).
4. Verify that all tests pass.
5. Submit a Pull Request with a clear summary of the changes, rationale, and validation output.
