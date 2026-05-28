# Migration Mappings

This document tracks deterministic mappings between Power Platform constructs and generated Azure artefacts.

## Mapping philosophy

1. All mappings consume validated `PowerPlatformIR` only.
2. No generator may map directly from raw Power Platform files.
3. Provenance from IR records must be preserved in generated artefact metadata.
4. Serialization of intermediate and final artefacts must remain deterministic.
5. Mapping work begins only after parser sections are stable in IR (currently solution, dataverse metadata, structured canvas metadata, structured flow metadata, environment variables, connection references, and security inventory).

## Current IR-ready sections

- `solution`
- `dataverse.entities`
- `dataverse.relationships`
- `dataverse.optionSets`
- `canvasApps` (apps, screens, controls, formulas, resources, references)
- `canvasApps.screens[].controls[].normalizedLayout` (layout mode/responsive hints/visibility/order)
- `canvasApps.screens[].controls[].role` and readiness metadata
- `cloudFlows` (trigger/action graph, connectors, references, expressions, readiness metadata)
- `environmentVariables`
- `connectionReferences`
- `security.roles`

These sections are now parse-populated and validated, and are consumed by the first deterministic assessment engine for readiness/risk planning and SQL generation.

## Dependency graph and summary prerequisites

Before generator mappings are introduced, the parser pipeline now provides:

- deterministic dependency edges with unresolved-reference annotations
- parser summary counts for discovered artifacts and unresolved dependencies
- parser summary counts for flow trigger/action/connectors/readiness and unresolved flow dependencies

What this summary does:

- reports parser inventory volume and coverage signals
- highlights unresolved dependency counts early

What this summary does not do:

- compute migration complexity
- compute migration risk
- produce recommendations

Those remain assessment-engine responsibilities in later milestones.

## Assessment interpretation notes (Milestone 7)

The assessment engine now consumes validated IR and produces:

- overall readiness/risk/complexity/confidence
- domain assessments (Dataverse/Canvas/Cloud Flows/Security/Connections/Dependencies)
- findings, recommendations, blockers, quick wins
- migration wave recommendations (Wave 0..4)

Interpretation guidance:

- Scores are deterministic heuristics, not machine-learned predictions.
- Findings are evidence-linked planning signals, not automatic conversion actions.
- Readiness indicates migration effort/risk posture, not guaranteed runtime parity.
- High confidence means parsing/assessment signal quality is stronger, not that migration is complete.

Canvas IR notes for future React generation:

- Canvas app inventory now includes app properties, screen/control hierarchy, control layout metadata, raw formulas, and extracted references.
- Canvas controls now include layout normalization (`absolute`, `verticalStack`, `horizontalStack`, `grid`, `galleryTemplate`, `formLayout`, `unknown`) while preserving raw source layout properties.
- Canvas controls now include role classification (`button`, `input`, `gallery`, `form`, `dataCard`, etc.) with confidence to support staged UI migration mapping.
- Canvas apps/screens/controls now include heuristic migration-readiness metadata (`high`, `medium`, `low`, `blocked`) and complexity dimensions (layout/formula/data-binding).
- Power Fx is stored as raw expressions with lightweight function/reference classification only.
- Unknown controls/properties are preserved and flagged to avoid silent migration fidelity loss.

## Implemented generator mapping: Dataverse -> Azure SQL DDL (Milestone 8)

CLI:

```bash
power-exit generate sql <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
```

Generated artifacts:

- `schema.sql`
- `generation-report.md`
- `generation-plan.json`
- `generation-plan.md`

Deterministic mapping currently implemented:

1. Entities -> `CREATE TABLE` in stable logical-name order.
2. Primary id attributes -> `PRIMARY KEY`.
3. Attribute type mapping:
   - `string` -> `NVARCHAR(n)` (default `255`)
   - `memo` -> `NVARCHAR(MAX)`
   - `integer` -> `INT`
   - `bigint` -> `BIGINT`
   - `decimal` -> `DECIMAL(p,s)` (default `18,2`)
   - `float` -> `FLOAT`
   - `money` -> `DECIMAL(19,4)`
   - `boolean` -> `BIT`
   - `datetime` -> `DATETIME2`
   - `date` -> `DATE`
   - `uniqueidentifier` -> `UNIQUEIDENTIFIER`
   - `lookup` / `owner` / `customer` -> `UNIQUEIDENTIFIER` candidate FK columns
   - `picklist` / `state` / `status` -> `INT` (+ option-set comments where discoverable)
4. Relationships:
   - one-to-many / many-to-one -> FK statements when lookup mapping is resolvable
   - many-to-many -> deterministic join table with composite PK + FK constraints
5. SQL identifier collision handling:
   - deterministic suffixing (`_2`, `_3`, ...)
   - explicit generation warnings
6. Name mapping traceability:
   - logical-to-SQL mappings emitted in `generation-report.md`.
7. SQL plan details emitted in generation plan:
   - tables to create
   - columns to create
   - FKs to create
   - join tables to create
   - unsupported columns
   - unresolved relationships
   - naming collisions

Overwrite safety behavior:

- Default mode skips conflicting existing files and records skip warnings/review items.
- `--force` allows planned overwrite actions.
- `--dry-run` writes only plan files (`generation-plan.json`, `generation-plan.md`), not generated SQL/report artifacts.
- `--dry-run --clean` performs planning as if marker-tagged files were cleaned, without mutating the filesystem.
- `--clean` removes only marker-tagged generated files and leaves unmarked files untouched.

Unsupported mapping behavior:

- Calculated, rollup, file/image, partylist/activityparty, and polymorphic/customer-heavy constructs produce explicit unsupported feature records and warnings.
- Virtual-table entities are flagged as unsupported for direct DDL fidelity.
- Unknown attribute types fall back to explicit warning + unsupported records (no silent fallback).

## Implemented generator mapping: Canvas IR -> React/Next.js skeletons (Milestone 8)

CLI:

```bash
power-exit generate react <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
```

Generated artifacts:

- `<app-slug>/app/page.tsx` (first screen route)
- `<app-slug>/app/<screen-slug>/page.tsx` (additional routes)
- `<app-slug>/components/generated/<screen>.tsx` (screen components)
- `migration-notes.md`
- `generation-report.md`
- `generation-plan.json`
- `generation-plan.md`

Deterministic mapping currently implemented:

1. App/screen/control ordering is stable and deterministic.
2. Control-role to JSX skeleton mapping:
   - `pageContainer` -> `main`
   - `sectionContainer` -> `section`
   - `card` -> `div`
   - `text`/`heading` -> `p`/`h2`
   - `button` -> `button`
   - `input` -> `input type="text"`
   - `select` -> `select`
   - `dateInput` -> `input type="date"`
   - `gallery` -> list placeholder container
   - `form` -> `form`
   - `dataCard` -> wrapper + field placeholder
   - `image` -> `img` placeholder
   - `icon` -> `span` placeholder
3. Unsupported controls (`html`, `customComponent`, `unknown`) are preserved with visible TODO placeholders.
4. Layout hints from normalized metadata are emitted as class names:
   - `layout-absolute`
   - `layout-vertical-stack`
   - `layout-horizontal-stack`
   - `layout-grid`
   - `layout-gallery-template`
   - `layout-form-layout`
   - `layout-unknown`
5. Raw Power Fx formulas are preserved as comments/TODO handler stubs (no semantic translation).
6. Formula hotspot planning records are emitted for each classified formula:
   - screen
   - control
   - property
   - formula bucket
   - original Power Fx
   - generated stub name
   - likely manual implementation area
   - severity
   - recommendation
7. Formula hotspot plan is written into `generation-plan.json`, `generation-plan.md`, and `migration-notes.md`.

Overwrite safety behavior:

- Default mode skips conflicting existing files and records skip warnings/review items.
- `--force` allows planned overwrite actions.
- `--dry-run` writes only plan files (`generation-plan.json`, `generation-plan.md`), not generated React/report artifacts.
- `--dry-run --clean` performs planning as if marker-tagged files were cleaned, without mutating the filesystem.
- `--clean` removes only marker-tagged generated files and leaves unmarked files untouched.

Current limitations:

- Output is migration scaffolding, not production-ready UI.
- No AI/v0/LLM prompt-driven enhancement path is applied in this pass.
- Formula/event behavior requires manual TypeScript conversion.
- Styling and responsive behavior are heuristic hints only, not pixel parity.

Future optional enhancement path:

1. Keep deterministic skeleton generation as the required first step.
2. Optionally run prompt-driven UI refinement (v0/LLM-assisted) as a separate reviewable stage.
3. Preserve traceability back to generated baseline files so human reviewers can diff and approve changes.

## Implemented generator mapping: Cloud Flows + Canvas data-operation hotspots -> Azure Functions scaffolds

CLI:

```bash
power-exit generate functions <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
```

Generated artifacts:

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
- `generation-plan.json`
- `generation-plan.md`

Deterministic mapping currently implemented:

1. Flow trigger mappings:
   - `manual`, `http` -> HTTP function scaffold
   - `recurrence` -> timer function scaffold
   - `dataverse` -> Dataverse/event placeholder (`eventGridTrigger`/`webhookTrigger` guidance) with safe HTTP/manual fallback
   - `email` -> email ingestion placeholder (`queueTrigger`/`webhookTrigger` guidance) with safe HTTP/manual fallback
   - `event` -> Event Grid placeholder with safe HTTP/manual fallback
   - unknown -> HTTP manual fallback + warning
2. Flow action mappings:
   - Dataverse-like actions -> `dataverseAdapter` TODO methods
   - HTTP-like actions -> `httpAdapter` TODO methods
   - Approval/human actions -> `approvalAdapter` TODO methods + manual workflow hotspots
   - Email-like actions -> `emailAdapter` TODO methods
   - Custom connectors -> `customConnectorAdapter` TODO methods
   - Condition/scope/loop actions -> structured control-flow TODO comments
   - Unknown actions -> unsupported action TODO + warning/unsupported feature
3. Flow handlers use a standard contract:
   - deterministic `*Handler` export name
   - typed request/context placeholders
   - validation/auth placeholders
   - consistent logging and try/catch error boundary
   - source provenance + original Flow snippet comments
4. Canvas data-operation hotspot mappings:
   - `Patch`, `SubmitForm`, `Remove`, `RemoveIf`
   - `Collect`, `ClearCollect`
   - `LookUp`, `Filter`, `Search`, `SortByColumns`
5. Canvas formula API handlers are grouped by likely data source where available.
6. Unresolved formula data source bindings emit warnings and manual review hotspots.
7. Functions generation plan metadata includes:
   - planned functions
   - planned adapter files
   - connector adapter mappings
   - trigger strategy
   - handler signatures
   - trigger type
   - source flow/action/formula ids
   - unsupported actions
   - unresolved dependencies
   - unresolved adapter requirements
   - deployment readiness flags (`scaffoldOnly`, `needsConfig`, `needsManualLogic`, `blocked`)
   - manual review hotspots
8. Scaffold packaging validation warns when expected files/directories are missing (`package.json`, `host.json`, `tsconfig.json`, `local.settings.example.json`, `src/functions`, `src/services`, `src/adapters`, `src/utils`).

Overwrite safety behavior:

- Default mode skips conflicting existing files and records skip warnings/review items.
- `--force` allows planned overwrite actions.
- `--dry-run` writes only plan files (`generation-plan.json`, `generation-plan.md`), not generated Functions scaffold artifacts.
- `--dry-run --clean` performs planning as if marker-tagged files were cleaned, without mutating the filesystem.
- `--clean` removes only marker-tagged generated files and leaves unmarked files untouched.

Current limitations:

- Scaffold output is intentionally non-production and contains TODO placeholders.
- No full Power Fx semantic execution is attempted.
- No Cloud Flow runtime semantic execution is attempted.
- Trigger placeholders for Dataverse/email/event/unknown require manual binding implementation.
- Connector-specific adapters are typed placeholders only and require manual implementation.
- Secrets and production environment values are not generated.

## Implemented generator mapping: migration workloads -> Azure infra Bicep scaffold

CLI:

```bash
power-exit generate infra <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]
```

Generated artifacts:

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
- `generation-plan.json`
- `generation-plan.md`

Deterministic mapping currently implemented:

1. Workload detection from validated IR signals:
   - React workload -> App Service scaffold path.
   - Functions workload -> Function App + Storage + App Insights + Managed Identity scaffold path.
   - SQL workload -> SQL Server + SQL Database scaffold path.
2. Shared baseline security resources:
   - Key Vault scaffold.
   - Managed identity scaffold.
   - Key Vault reference placeholders for app settings.
3. Environment parameterization:
   - deterministic `parameters.dev.json`, `parameters.test.json`, `parameters.prod.json`.
   - placeholder-only values for location/SKUs and environment-specific naming.
4. Security-first TODO posture:
   - private networking/private endpoints
   - Entra ID auth enforcement
   - SQL firewall/network hardening
   - RBAC least-privilege role assignment
   - monitoring/alerting setup
   - backup/retention policy definition
   - environment promotion/release governance
5. Infra generation plan metadata emitted in `infraPlan`:
   - planned resources
   - planned modules
   - environment parameter files
   - security manual review items
   - unresolved configuration items
   - content hashes
   - deployment readiness flags (`scaffoldOnly`, `needsConfig`, `needsSecurityReview`, `blocked`)

Overwrite safety behavior:

- Default mode skips conflicting existing files and records skip warnings/review items.
- `--force` allows planned overwrite actions.
- `--dry-run` writes only plan files (`generation-plan.json`, `generation-plan.md`), not generated infra artifacts.
- `--dry-run --clean` performs planning as if marker-tagged files were cleaned, without mutating the filesystem.
- `--clean` removes only marker-tagged generated files and leaves unmarked files untouched.

Remaining planned mapping section:

1. Azure Functions scaffold hardening into deployable service adapters (post-MVP).
2. Infra scaffold extension for production-grade networking policy templates and environment promotion automation.

## Implemented CLI orchestration mapping: `migrate` end-to-end workflow

CLI:

```bash
power-exit migrate <solution-folder> --out <output-folder> [--dry-run] [--force] [--clean]
```

Deterministic orchestration currently implemented:

1. Analyse solution -> validate IR -> write `ir.json`.
2. Generate assessment markdown -> write `assessment-report.md`.
3. Generate SQL artifacts under `sql/`.
4. Generate React artifacts under `react/`.
5. Generate Functions artifacts under `functions/`.
6. Generate Infra artifacts under `infra/`.
7. Build master `migration-plan.md` with summary/readiness/risk/complexity/hotspots/unsupported/security/waves/next tasks.
8. Build master `generation-plan.json` + `generation-plan.md` covering all planned files/actions/hashes/manual review items and plan detail blocks (`sqlPlan`, `functionsPlan`, `infraPlan`, formula hotspots).

Dry-run behavior:

- `migrate --dry-run` still performs full analysis + generation planning.
- Non-report scaffold artifacts are not emitted.
- Master reports/plans are emitted for review (`ir.json`, `assessment-report.md`, `migration-plan.md`, `generation-plan.json`, `generation-plan.md`).

Determinism validation harness:

- Multi-run tests execute `migrate` repeatedly against the same fixture and compare:
  - file lists
  - file content hashes
  - report/plan content equivalence
- Any ordering drift/hash drift fails tests.
