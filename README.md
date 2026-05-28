# Power Exit

Power Exit is a migration assessment and code generation engine for unpacked Microsoft Power Platform solutions.

The system follows a strict, traceable pipeline:

1. Parse solution assets into typed data.
2. Validate and normalize into a shared Intermediate Representation (IR).
3. Assess migration complexity, confidence, and unsupported features.
4. Generate deterministic migration artefacts (reports, Azure SQL, React skeletons, Azure Functions scaffolds, Azure infra/Bicep scaffolds).

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
power-exit generate functions <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
power-exit generate infra <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
power-exit migrate <solution-folder> --out <output-folder> [--dry-run] [--force] [--clean] [--gate] [--policy <policy-file>] [--profile <profile-name>]
power-exit gate <output-folder> [--ci] [--strict] [--policy <policy-file>] [--profile <profile-name>] [--max-risk <number>] [--max-complexity <number>] [--min-confidence <number>] [--max-unresolved <number>] [--allow-critical-unsupported]
power-exit init-policy --out <output-folder>
power-exit pack <output-folder> --out <pack-folder>
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

`generate functions` command behavior:

1. Read and validate an existing `ir.json`.
2. Run deterministic Azure Functions scaffold generation from Cloud Flow IR + Canvas formula data-operation hotspots.
3. Generate typed adapter boundaries under `src/adapters` (`connectorAdapter`, `dataverseAdapter`, `httpAdapter`, `emailAdapter`, `approvalAdapter`, `customConnectorAdapter`) with scaffold-only TODO contracts.
4. Standardize typed handler contracts (deterministic names, logging, validation/auth placeholders, try/catch boundaries, provenance/snippet comments).
5. Build deterministic `generation-plan.json` + `generation-plan.md` including planned adapter files, connector mappings, trigger strategy, handler signatures, unresolved adapter requirements, and deployment readiness flags.
6. Run scaffold packaging checks for required files/directories (`package.json`, `host.json`, `tsconfig.json`, `local.settings.example.json`, `src/functions`, `src/services`, `src/adapters`, `src/utils`) and emit warnings for gaps.
7. Default safe-write mode skips conflicting existing files (unless `--force`).
8. Write scaffold files (or only plan files when `--dry-run`).
9. Print structured summary counts (total functions, flow functions, canvas API functions, warnings, unsupported features, plan summary).

`generate infra` command behavior:

1. Read and validate an existing `ir.json`.
2. Run deterministic Azure infra scaffold generation from validated IR summary/workload signals.
3. Generate an `infra/` Bicep project scaffold with `main.bicep`, environment parameter files, and deterministic module files for App Service, Function App, Storage, SQL Server, SQL Database, Key Vault, App Insights, and Managed Identity.
4. Emit security-first placeholders only: managed identity, Key Vault references, app settings placeholders, and explicit manual hardening TODOs (no secrets/credentials).
5. Build deterministic `generation-plan.json` + `generation-plan.md` including `infraPlan` metadata (planned resources/modules, parameter files, security review items, unresolved config items, content hashes, deployment readiness).
6. Default safe-write mode skips conflicting existing files (unless `--force`).
7. Write scaffold files (or only plan files when `--dry-run`).
8. Print structured summary counts (resources/modules/parameter files, warnings, unsupported features, plan summary).

`migrate` command behavior:

1. Analyse solution and validate deterministic IR.
2. Write `ir.json` and `assessment-report.md`.
3. Run SQL, React, Functions, and Infra generators from the same validated IR.
4. Compose a master `generation-plan.json` + `generation-plan.md` spanning all generated outputs.
5. Write a master `migration-plan.md` with executive summary, readiness/risk/complexity, hotspots, unsupported features, security notes, migration waves, and next tasks.
6. Apply safe-write semantics across all generated artifacts (`--dry-run`, `--force`, `--clean`).
7. Optional `--gate` writes `readiness-gate.json` + `readiness-gate.md` from IR + assessment + generation plan signals.
7. Emit structured migrate summary metrics in CLI output.

`gate` command behavior:

1. Read `ir.json` and deterministically recompute assessment scores.
2. Read optional policy (`--policy`) and profile (`--profile`, defaults to `dev` when policy is provided).
3. Read `generation-plan.json` when present (fallback to IR+assessment-only mode when missing).
4. Apply deterministic readiness thresholds and waiver governance (`allowedWaivers[]`) and write:
   - `readiness-gate.json`
   - `readiness-gate.md`
5. Emit explainable status reasons (`pass` | `warn` | `fail`) with original/effective status, policy context, waiver audit (applied/expired/invalid), blockers, unresolved dependencies, high-severity findings, unsupported features, manual review items, and recommendations.
6. Threshold precedence is deterministic: built-in defaults -> selected policy profile -> explicit CLI flags.
7. In `--ci` mode, exit codes are:
   - `0` for `pass`
   - `1` for `fail`
   - `0` for `warn` unless `--strict` is set
   - `1` for `warn` when `--strict` is set

`init-policy` command behavior:

1. Writes deterministic `power-exit.policy.json` and `power-exit.policy.md`.
2. Seeds four profile templates (`dev`, `test`, `prod`, `strict`) with conservative governance defaults.
3. Adds no organization-specific assumptions or environment secrets.

`pack` command behavior:

1. Consumes an existing analyse/migrate output folder (requires `ir.json`).
2. Recomputes deterministic assessment signals from IR and uses optional existing inputs when present:
   - `assessment-report.md`
   - `migration-plan.md`
   - `generation-plan.json` / `generation-plan.md`
   - `readiness-gate.json` / `readiness-gate.md`
   - generator report assets under `sql/`, `react/`, `functions/`, `infra/`
3. Produces a deterministic client-facing pack in `--out <pack-folder>`:
   - `executive-summary.md`
   - `technical-findings.md`
   - `migration-roadmap.md`
   - `risk-register.md`
   - `quick-wins.md`
   - `unsupported-features.md`
   - `manual-review-log.md`
   - `generated-assets-index.md`
   - `client-pack.json`

Default readiness thresholds:

- `maxRiskScore=70`
- `maxComplexityScore=70`
- `minConfidence=0.60`
- `allowCriticalUnsupported=false`
- `maxUnresolvedDependencies=6`
- `maxHighSeverityFindings=8`
- `requireNoBlockers=true`

Readiness gate interpretation:

- `pass`: package is within configured thresholds and has no enforced blockers.
- `warn`: package is viable but requires explicit manual review/sign-off before proceeding.
- `fail`: package should be blocked until fail reasons are remediated.

Profile strategy:

- `dev`: relaxed thresholds for early iteration and migration discovery.
- `test`: stronger defaults for integration environments.
- `prod`: conservative thresholds and evidence-oriented waiver governance.
- `strict`: highest governance posture with minimal unresolved risk tolerance.

Waiver governance expectations:

- Waivers are audit records; they never remove evidence from gate outputs.
- Expired or invalid waivers are ignored and surfaced as warnings.
- Critical waived items require `riskAccepted=true`.
- Waivers typically reduce fail -> warn when policy allows, but still require explicit sign-off.

The gate is advisory by default (non-CI mode always exits `0`); use `--ci` (typically with `--policy` + `--profile prod`) to enforce pipeline outcomes.

Client pack purpose:

- `executive-summary.md` is board/demo friendly and minimizes technical jargon.
- `technical-findings.md`, plans, and generation artifacts remain engineering-facing evidence.
- Consultancy/discovery workflows should present client-pack files first, with technical reports as drill-down artifacts.

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
- `functionsPlan` (Functions generator)
- `infraPlan` (Infra/Bicep generator)
- `manualReviewItems[]`
- `summary` metrics
- `sqlPlan` details (SQL generator)

Recommended review flow before committing generated outputs:

1. Run `generate ... --dry-run` first.
2. Review `generation-plan.json` and `generation-plan.md`.
3. Resolve or accept `skippedFiles` and `manualReviewItems`.
4. Re-run generation with `--force` only when explicit overwrite intent is confirmed.
5. Use `--clean` only when you want to clear previously generated (marker-tagged) files safely.

## Azure Functions scaffold generation (Milestone 10 hardening pass)

Current scaffold output:

- `package.json`
- `tsconfig.json`
- `host.json`
- `local.settings.example.json`
- `README.generated.md`
- `src/functions/*`
- `src/adapters/connectorAdapter.ts`
- `src/adapters/dataverseAdapter.ts`
- `src/adapters/httpAdapter.ts`
- `src/adapters/emailAdapter.ts`
- `src/adapters/approvalAdapter.ts`
- `src/adapters/customConnectorAdapter.ts`
- `src/services/authContext.ts`
- `src/services/validation.ts`
- `src/utils/logger.ts`
- `generation-report.md`
- `migration-notes.md`

Flow trigger mapping strategy:

- `manual` / `http` -> HTTP function scaffold
- `recurrence` -> timer function scaffold
- `dataverse` -> Dataverse/event placeholder (`eventGridTrigger`/`webhookTrigger` guidance) with safe HTTP manual fallback
- `email` -> email ingestion placeholder (`queueTrigger`/`webhookTrigger` guidance) with safe HTTP manual fallback
- `event` -> Event Grid placeholder with safe HTTP manual fallback
- unknown -> HTTP manual fallback + warning

Flow action mapping strategy:

- Dataverse-like actions -> `dataverseAdapter` TODO methods
- HTTP-like actions -> `httpAdapter` TODO methods
- Approval/human actions -> `approvalAdapter` TODO methods + manual workflow hotspot
- Email-like actions -> `emailAdapter` TODO methods
- Custom connectors -> `customConnectorAdapter` TODO methods
- Condition/scope/loop actions -> structured control-flow TODO comments
- Unknown actions -> unsupported-action TODO + warning/unsupported record

Canvas formula API stub strategy:

- Generates HTTP API stubs for data-operation hotspots:
  - `Patch`, `SubmitForm`, `Remove`, `RemoveIf`
  - `Collect`, `ClearCollect`
  - `LookUp`, `Filter`, `Search`, `SortByColumns`
- Groups handlers by likely data source where available.
- Emits warnings/manual review hotspots for unresolved data source binding.

Security/no-secrets assumptions:

- No runtime secrets are generated.
- `local.settings.example.json` contains placeholders only.
- Adapter files do not contain live API calls or credentials.
- Generated code is migration scaffolding, not production-ready business logic.

## Azure infrastructure scaffold generation (Bicep scaffold pass)

Current infra scaffold output:

- `infra/main.bicep`
- `infra/parameters.dev.json`
- `infra/parameters.test.json`
- `infra/parameters.prod.json`
- `infra/modules/app-service.bicep`
- `infra/modules/function-app.bicep`
- `infra/modules/storage.bicep`
- `infra/modules/sql-server.bicep`
- `infra/modules/sql-database.bicep`
- `infra/modules/key-vault.bicep`
- `infra/modules/app-insights.bicep`
- `infra/modules/managed-identity.bicep`
- `infra/README.generated.md`
- `infra/generation-report.md`
- `infra/migration-notes.md`

Resource mapping strategy:

- React workloads -> App Service placeholders + app setting TODO stubs (with optional static hosting decision TODO).
- Functions workloads -> Function App + Storage + App Insights + Managed Identity + Key Vault app-setting references.
- SQL workloads -> Azure SQL Server + Azure SQL Database scaffold with explicit firewall/private endpoint TODOs.
- Shared config/secrets -> Key Vault + managed identity references (no secret values emitted).

Security-first defaults:

- Managed identity and Key Vault placeholders are generated by default.
- Sensitive values are represented as placeholder references only; no live credentials/secrets are emitted.
- Networking/private endpoints, Entra ID auth, SQL firewall, RBAC, monitoring/alerting, backup/retention, and environment promotion are explicit TODOs in generated infra artifacts.
- Deployment readiness is scaffold-only and requires manual configuration + security review.

## End-to-end quickstart

Use this deterministic sequence for a full migration packaging run:

1. `power-exit analyse <solution-folder> --out <output-folder>`
2. `power-exit report <output-folder>/ir.json --out <output-folder>`
3. `power-exit generate sql <output-folder>/ir.json --out <output-folder>`
4. `power-exit generate react <output-folder>/ir.json --out <output-folder>`
5. `power-exit generate functions <output-folder>/ir.json --out <output-folder>`
6. `power-exit generate infra <output-folder>/ir.json --out <output-folder>`
7. `power-exit init-policy --out <output-folder>`
8. `power-exit migrate <solution-folder> --out <output-folder> --gate --policy <output-folder>/power-exit.policy.json --profile prod`
9. `power-exit gate <output-folder> --ci --policy <output-folder>/power-exit.policy.json --profile prod`
10. `power-exit pack <output-folder> --out <output-folder>/client-pack`

Sample command block:

```bash
power-exit migrate packages/fixtures/samples/solutions/migrate-e2e --out ./out/migrate-e2e
power-exit migrate packages/fixtures/samples/solutions/migrate-e2e --out ./out/migrate-e2e-dry --dry-run
power-exit init-policy --out ./out/migrate-e2e
power-exit gate ./out/migrate-e2e --ci --policy ./out/migrate-e2e/power-exit.policy.json --profile prod --strict
power-exit pack ./out/migrate-e2e --out ./out/migrate-e2e/client-pack
```

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
