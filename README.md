# Power Exit

Power Exit is a migration assessment and code generation engine for unpacked Microsoft Power Platform solutions.

The system follows a strict, traceable pipeline:

1. Parse solution assets into typed data.
2. Validate and normalize into a shared Intermediate Representation (IR).
3. Assess migration complexity, confidence, and unsupported features.
4. Generate deterministic migration artefacts (reports, Azure SQL, React skeletons).

## Repository layout

```text
apps/
  cli/        # Command-line interface
  web/        # Web UI (planned)

packages/
  assessment/ # Scoring and recommendations
  fixtures/   # Shared fixtures for parser and generator tests
  generators/ # Report and code generators from IR
  ir/         # Typed Zod-backed Intermediate Representation
  parsers/    # Power Platform parsers
  powerfx/    # Power Fx extraction and handling

docs/
  assumptions.md
  unsupported-features.md
  mvp-backlog.md
```

## Engineering principles

- TypeScript monorepo with workspace packages.
- Deterministic outputs for generated artefacts.
- Shared deterministic helpers are provided in `packages/ir` and reused by parsers and generators.
- Fixture-driven tests for all parser and generator behavior.
- Unsupported or unknown source features are always surfaced, never silently ignored.
- Parsers return a standard envelope:
  - `data`
  - `warnings[]`
  - `unsupported[]`
  - `confidence`

## Getting started

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## Current MVP status

The repository currently contains the foundation scaffolding and backlog for implementing the MVP in dependency order. See `docs/mvp-backlog.md`.

Fixture helper utilities are available in `packages/fixtures/src/load-fixture.ts` for deterministic fixture-based parser testing.
