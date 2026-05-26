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
  migration-mappings.md
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
- All generator work is blocked on validated IR, never raw source files.

## IR and parser contract philosophy

- `packages/ir` is the single runtime-validated contract for all migration state.
- All IR objects are strict Zod schemas to prevent silent shape drift.
- Source-derived records include provenance so outputs can be traced back to files.
- Parser interfaces in `packages/parsers` are contract-only in this pass: no domain parsing logic yet.
- Every parser result is validated as `ParseResult<T>` with warnings, unsupported features, and confidence.

## CLI skeleton (current pass)

The CLI now supports a foundational command:

```bash
power-exit analyse <solution-folder> --out <output-folder>
```

Current behavior is intentionally limited:

1. Validate input folder exists.
2. Build an empty but schema-valid `PowerPlatformIR`.
3. Serialize deterministic JSON.
4. Write `ir.json` to the output folder.
5. Print a structured execution summary.

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
