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
- Parser implementations currently cover solution discovery, manifest metadata, Dataverse metadata, structured Canvas metadata, structured Cloud Flow metadata, environment variables, connection references, and security role inventory.
- Every parser result is validated as `ParseResult<T>` with warnings, unsupported features, and confidence.
- IR now includes a dependency graph edge model with unresolved-reference metadata.
- IR now includes a lightweight parser summary layer (counts only), not full assessment scoring.
- Canvas controls now include normalized layout metadata, control role classification, and heuristic migration-readiness metadata for UI migration planning.
- `@power-exit/assessment` now provides deterministic migration assessment outputs (risk, complexity, readiness, confidence, findings, recommendations, blockers, quick wins, migration waves).

## CLI skeleton (current pass)

The CLI now supports a foundational command:

```bash
power-exit analyse <solution-folder> --out <output-folder>
power-exit analyse <solution-folder> --out <output-folder> --report
power-exit report <ir-json> --out <output-folder>
power-exit generate sql <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
power-exit generate react <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
```

Current behavior in this sprint:

1. Validate input folder exists.
2. Deterministically discover/classify solution files.
3. Parse solution manifest (`solution.xml`) metadata.
4. Parse Dataverse entities, attributes, relationships, and option sets.
5. Parse structured Canvas app metadata (apps, screens, controls, formulas, resources, references), normalize control layout, classify control roles, and score Canvas migration readiness heuristically.
6. Parse structured Cloud Flow metadata (triggers, actions, runAfter graph, connectors, references, expressions, readiness heuristics).
7. Parse environment variables, connection references, and security roles.
8. Merge all parse results into validated `PowerPlatformIR`.
9. Serialize deterministic JSON and write `ir.json`.
10. Build deterministic dependency edges and unresolved dependency warnings.
11. Attach lightweight analysis summary counts to `ir.json`.
12. Optionally generate `assessment-report.md` using `--report`.
13. Print structured counts in CLI output, including Canvas and Flow readiness breakdowns.

`report` command behavior:

1. Read and validate an existing `ir.json`.
2. Run deterministic assessment heuristics across Dataverse, Canvas, Cloud Flows, Security, Connections, and Dependencies.
3. Generate `assessment-report.md` with executive summary, risk/complexity/confidence, blockers, quick wins, domain sections, unsupported/warnings, migration waves, and next steps.

`generate sql` command behavior:

1. Read and validate an existing `ir.json`.
2. Run the deterministic Dataverse-to-Azure SQL generator from `@power-exit/generators`.
3. Build a deterministic `generation-plan.json` + `generation-plan.md` (planned files/directories, hashes, actions, warnings, unsupported features, SQL plan details).
4. Default safe-write mode skips conflicting existing files (unless `--force`) and records skip warnings/manual review items.
5. Write `schema.sql` and `generation-report.md` only for planned `create`/`overwrite` actions (or no generated files when `--dry-run`).
6. Print structured summary counts (tables, columns, relationships, warnings, unsupported features, plan summary).

`generate react` command behavior:

1. Read and validate an existing `ir.json`.
2. Run deterministic Canvas-to-React skeleton generation from `@power-exit/generators`.
3. Build a deterministic `generation-plan.json` + `generation-plan.md` including formula hotspot planning data.
4. Default safe-write mode skips conflicting existing files (unless `--force`) and records skip warnings/manual review items.
5. Write Next.js-style generated routes/components plus `migration-notes.md` and `generation-report.md` only for planned `create`/`overwrite` actions (or no generated files when `--dry-run`).
6. Print structured summary counts (apps, screens, controls, formulas preserved/classified, hotspots, unsupported controls, warnings, plan summary).

`--clean` behavior:

- Removes only files that already contain the Power Exit generated-file marker:
  - `Generated by Power Exit.`
  - `Do not edit directly unless you intend to own the generated file.`
- Leaves user-owned files untouched when the marker is absent.
- With `--dry-run`, clean is simulated for planning decisions and does not delete files.

## Generator framework (Milestone 8)

`@power-exit/generators` now exposes a deterministic generator contract layer:

- `GeneratorContext`
- `Generator<TInput, TOutput>`
- `GeneratedArtifact`
- `GenerationResult`
- `GenerationWarning`
- `GenerationUnsupportedFeature`
- `GeneratorRegistry`
- `GeneratorCapability`

Every generated artifact includes artifact id, artifact type, output file path, content, source artifact ids, warnings, provenance, and confidence.

Generator architecture rules:

- Generators consume validated IR/assessment inputs only.
- Generators do not read raw Power Platform source files.
- Unsupported conversions are explicit generation warnings/unsupported records.
- Output ordering and serialized content are deterministic.
- Every generation run now emits a deterministic generation plan before/alongside file writes.

## Generator hardening (Milestone 9)

`@power-exit/generators` now includes a deterministic generation planning model consumed by CLI generation commands:

- `plannedFiles[]` with:
  - path
  - artifact type
  - source artifact ids
  - action (`create` | `overwrite` | `skip` | `unchanged`)
  - content hash
  - confidence
  - warnings
- `plannedDirectories[]`
- `skippedFiles[]`
- `overwrittenFiles[]`
- `warnings[]`
- `unsupportedFeatures[]`
- `formulaHotspots[]` (React)
- `manualReviewItems[]`
- `summary` metrics
- `sqlPlan` details (SQL generator)

Recommended review flow before committing generated outputs:

1. Run `generate ... --dry-run` first.
2. Review `generation-plan.json` and `generation-plan.md`.
3. Resolve or accept `skippedFiles` and `manualReviewItems`.
4. Re-run generation with `--force` only when explicit overwrite intent is confirmed.
5. Use `--clean` only when you want to clear previously generated (marker-tagged) files safely.

## Azure SQL DDL generation (first generator)

Current SQL generator scope:

- Dataverse entities -> SQL tables + primary keys.
- Dataverse attributes -> SQL columns (string, memo, int, bigint, decimal, float, money, boolean, datetime, date, guid, lookup/owner/customer candidate IDs, choice/state/status as int).
- One-to-many and many-to-one relationships -> foreign keys when resolvable.
- Many-to-many relationships -> deterministic join table generation when resolvable.
- Option sets/choices -> integer storage with mapping comments where discoverable.
- Logical-name to SQL-name mappings -> emitted in `generation-report.md`.
- SQL planning details -> emitted in generation plan (`tables`, `columns`, `FKs`, `join tables`, `unsupported columns`, `unresolved relationships`, `naming collisions`).

Current SQL generator limitations:

- Calculated, rollup, file/image, activity party/partylist, and polymorphic/customer-heavy behaviors are surfaced as unsupported features requiring manual migration design.
- Virtual table entities are flagged as unsupported for direct DDL parity.
- Generated SQL is a deterministic migration starting point, not a guaranteed production schema.

## React screen skeleton generation (Milestone 8)

Current React generator scope:

- Canvas apps -> Next.js app-router skeleton folders (`app/page.tsx`, screen routes, generated components).
- Screens -> deterministic component files under `components/generated`.
- Controls -> role-based base JSX mapping (containers, text, button, input, select, date input, gallery, form, data card, image, icon).
- Unsupported roles (`html`, `customComponent`, `unknown`) -> visible TODO placeholders (never silently dropped).
- Normalized Canvas layout metadata -> class-name hints for absolute/stack/grid/gallery/form/unknown modes.
- Formulas -> preserved as TODO comments/handlers only (no semantic Power Fx translation).
- Formula hotspot planning -> deterministic records for screen/control/property/bucket/stub/manual-area/severity/recommendation in generation plan + migration notes.
- Migration metadata -> `migration-notes.md` + `generation-report.md`.

Current React generator limitations:

- Generated React output is intentionally scaffold-level, not production-ready UI.
- No AI API / external model dependency is used in generation.
- No full Power Fx-to-TypeScript translation is performed in this pass.
- Generated handlers and placeholders require manual migration work.

Future optional enhancement path (not enabled in MVP):

- Add opt-in prompt-driven UI polishing (for example via v0/LLM workflows) after deterministic scaffolds are generated and reviewed.
- Keep deterministic skeleton generation as the primary baseline so prompt-driven steps are reviewable and non-blocking.

## Assessment model (Milestone 7)

Assessment outputs are deterministic and explainable:

- Overall outputs:
  - readiness (`high` | `medium` | `low` | `blocked`)
  - risk score (`0..100`)
  - complexity score (`0..100`)
  - confidence (`0..1`)
- Domain outputs:
  - Dataverse
  - Canvas
  - Cloud Flows
  - Security
  - Connections
  - Dependencies
- Structured evidence outputs:
  - findings
  - recommendations
  - blockers
  - quick wins
  - migration waves (Wave 0..4)

Heuristics currently use IR signals including unsupported counts/severity, warnings, unresolved dependencies, unknown files, Dataverse schema volume, Canvas/Flow readiness, premium/custom connectors, malformed/conflicting metadata warnings, and domain confidences.

Important limitation:

- The assessment output is a migration planning aid, not a guarantee of automatic conversion success.

## Dependency graph model

Dependency edges currently capture where detectable:

- solution -> entities/workflows/canvas apps
- canvas app -> screens
- screen -> controls
- screen -> layout containers
- parent control -> child control
- gallery -> template child controls
- form -> data cards
- data cards -> bound fields
- controls -> formulas
- control/formula -> data sources
- formula -> variables and collections
- Navigate formulas -> target screens
- Patch/SubmitForm formulas -> likely target data source
- entities -> attributes/relationships
- relationships -> target entities
- flow -> trigger/action nodes
- trigger -> first actions
- action -> action (`runAfter`)
- scope -> child actions
- action -> connectors/connection references/Dataverse entities
- expressions -> referenced variables/entities/environment variables/actions/triggers
- environment variables -> dependent artifacts
- security roles -> privilege-target entities

Each edge stores source id, target id, dependency type, provenance, confidence, and unresolved warning details when applicable.

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
