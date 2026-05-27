# Migration Mappings

This document tracks deterministic mappings between Power Platform constructs and generated Azure artefacts.

## Mapping philosophy

1. All mappings consume validated `PowerPlatformIR` only.
2. No generator may map directly from raw Power Platform files.
3. Provenance from IR records must be preserved in generated artefact metadata.
4. Serialization of intermediate and final artefacts must remain deterministic.
5. Mapping work begins only after parser sections are stable in IR (currently solution, dataverse metadata, structured canvas metadata, environment variables, connection references, and security inventory).

## Current IR-ready sections

- `solution`
- `dataverse.entities`
- `dataverse.relationships`
- `dataverse.optionSets`
- `canvasApps` (apps, screens, controls, formulas, resources, references)
- `canvasApps.screens[].controls[].normalizedLayout` (layout mode/responsive hints/visibility/order)
- `canvasApps.screens[].controls[].role` and readiness metadata
- `environmentVariables`
- `connectionReferences`
- `security.roles`

These sections are now parse-populated and validated, but no generator logic is implemented in this sprint.

## Dependency graph and summary prerequisites

Before generator mappings are introduced, the parser pipeline now provides:

- deterministic dependency edges with unresolved-reference annotations
- parser summary counts for discovered artifacts and unresolved dependencies

What this summary does:

- reports parser inventory volume and coverage signals
- highlights unresolved dependency counts early

What this summary does not do:

- compute migration complexity
- compute migration risk
- produce recommendations

Those remain assessment-engine responsibilities in later milestones.

Canvas IR notes for future React generation:

- Canvas app inventory now includes app properties, screen/control hierarchy, control layout metadata, raw formulas, and extracted references.
- Canvas controls now include layout normalization (`absolute`, `verticalStack`, `horizontalStack`, `grid`, `galleryTemplate`, `formLayout`, `unknown`) while preserving raw source layout properties.
- Canvas controls now include role classification (`button`, `input`, `gallery`, `form`, `dataCard`, etc.) with confidence to support staged UI migration mapping.
- Canvas apps/screens/controls now include heuristic migration-readiness metadata (`high`, `medium`, `low`, `blocked`) and complexity dimensions (layout/formula/data-binding).
- Power Fx is stored as raw expressions with lightweight function/reference classification only.
- Unknown controls/properties are preserved and flagged to avoid silent migration fidelity loss.

Planned mapping sections:

1. Dataverse table metadata -> Azure SQL DDL
2. Dataverse options/choices -> lookup and enum mapping strategy
3. Canvas screens and controls -> React screen skeleton primitives
4. Cloud flow triggers/actions -> migration advisory mappings

Mappings are introduced incrementally once parser and IR milestones are complete.
