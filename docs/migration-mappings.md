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
power-exit generate sql <ir-json> --out <output-folder>
```

Generated artifacts:

- `schema.sql`
- `generation-report.md`

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

Unsupported mapping behavior:

- Calculated, rollup, file/image, partylist/activityparty, and polymorphic/customer-heavy constructs produce explicit unsupported feature records and warnings.
- Virtual-table entities are flagged as unsupported for direct DDL fidelity.
- Unknown attribute types fall back to explicit warning + unsupported records (no silent fallback).

Remaining planned mapping sections:

1. React screen skeleton generation from Canvas IR.
2. Flow migration advisory mappings for future Azure Functions / Logic Apps generation.
