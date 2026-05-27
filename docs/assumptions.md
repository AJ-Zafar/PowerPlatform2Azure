# Assumptions

## Product and scope assumptions

1. The MVP is CLI-first; `apps/web` remains scaffolded until parser/IR/generator flows are stable.
2. Power Fx handling in MVP is inventory and raw expression preservation only, without semantic translation.
3. Deterministic output means stable ordering of entities, attributes, controls, flows, and generated file sections.
4. Unsupported source constructs must be emitted as structured records and included in reports.
5. Current implementation scope includes solution discovery, manifest parsing, Dataverse metadata extraction, structured Canvas extraction, and infrastructure metadata extraction.
6. Full Power Fx semantic translation, flow semantic parsing, generators, and scoring engines remain out of scope for this sprint.
7. Lightweight summary counts in IR are parser telemetry only; they are not migration risk/complexity scoring.

## Repository assumptions

1. Existing empty directories (`packages/rules`, `packages/test-fixtures`) are treated as legacy placeholders and are not used for MVP implementation.
2. Canonical package layout for implementation is:
   - `packages/assessment`
   - `packages/fixtures`
   - `packages/generators`
   - `packages/ir`
   - `packages/parsers`
   - `packages/powerfx`
3. New code is authored in TypeScript and validated by root scripts:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`

## Parser contract assumptions

All parser modules converge on the contract:

```ts
{
  data,
  warnings: [],
  unsupported: [],
  confidence,
  provenance
}
```

Where:

- `warnings` are non-blocking anomalies that still produced interpretable data.
- `unsupported` are unsupported constructs that affect migration fidelity.
- `confidence` is a bounded numeric score (`0..1`) derived from parse completeness and unsupported density.
- `provenance` captures where parser output came from, to preserve traceability into reports and generated artefacts.
- Parse failures are never silent: malformed XML and unknown file layouts always produce structured warnings.
- Canvas malformed source files and unknown control/property shapes produce warnings/unsupported records while preserving parseable structure.
- Duplicate/conflicting metadata is surfaced as parser warnings and does not crash the run.
- Unresolved references are represented both as warnings and as unresolved dependency edges.

## IR design assumptions

1. `PowerPlatformIR` is the canonical boundary between parsing and all downstream assessment/generation work.
2. IR validation is strict (`z.strictObject` behavior) to avoid silently accepting unknown keys.
3. Deterministic output means identical IR payloads always serialize to identical JSON bytes.
4. Unsupported features and warnings are first-class top-level IR data, not side-channel logs.
5. Dataverse and infrastructure artifacts include provenance and per-artifact confidence fields.
6. Dependency graph edges are deterministic and sorted, with unresolved edges carrying `unresolvedWarning`.
7. Canvas IR preserves raw Power Fx expressions and extracted references (functions, data sources, variables, collections, navigation targets) without semantic execution.
