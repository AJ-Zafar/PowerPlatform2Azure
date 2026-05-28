# Assumptions

## Product and scope assumptions

1. The MVP is CLI-first; `apps/web` remains scaffolded until parser/IR/generator flows are stable.
2. Power Fx handling in MVP is inventory and raw expression preservation only, without semantic translation.
3. Deterministic output means stable ordering of entities, attributes, controls, flows, and generated file sections.
4. Unsupported source constructs must be emitted as structured records and included in reports.
5. Current implementation scope includes solution discovery, manifest parsing, Dataverse metadata extraction, structured Canvas extraction, structured Cloud Flow extraction, and infrastructure metadata extraction.
6. This sprint includes first-pass deterministic assessment heuristics and report generation from validated IR.
7. This sprint adds deterministic SQL (`power-exit generate sql`) and React skeleton (`power-exit generate react`) generators from validated IR.
8. Full Power Fx semantic translation, production-ready Azure Functions/infra deployment logic, and non-heuristic assessment scoring remain out of scope.
9. React generation in this pass is scaffold-oriented (route/component skeletons + TODO placeholders), not polished production UI conversion.
10. No AI API, model API, or external service dependency is used for generator output in this pass.
11. Lightweight summary counts in IR remain parser telemetry; assessment outputs consume these signals but remain heuristic.
12. Canvas migration-readiness in this pass is heuristic metadata for UI migration preparation, not final conversion logic.
13. Generator commands are plan-first: every generation run produces deterministic `generation-plan.json` and `generation-plan.md`.
14. Default generation mode is overwrite-safe: conflicting existing files are skipped unless `--force` is explicitly set.
15. `--dry-run` is a non-emitting mode for generated artifacts; only plan files are written for review.
16. `--clean` only removes files carrying the Power Exit generated-file marker and must not delete user-owned files.
17. Azure Functions generation is scaffold-only and deterministic; it does not implement production business logic.
18. Azure Functions generation maps flow triggers/actions and canvas data operations into typed handler contracts and adapter TODO stubs without semantic execution.
19. Azure Functions generation emits typed connector adapter boundaries (`src/adapters/*.ts`) and never includes live connector credentials or real API calls.
20. No secrets are emitted; generated settings files use placeholders exclusively.
21. Azure infra generation is scaffold-only and deterministic; it does not deploy resources and does not emit credential/secret values.
22. Infra generation defaults to managed identity + Key Vault reference patterns and emits explicit TODOs for private networking, Entra ID auth, RBAC, monitoring, and backup/retention hardening.
23. Infra generation plan metadata (`infraPlan`) is included for review workflows and captures resources/modules/parameter files/security review items/unresolved config/content hashes/deployment readiness.
24. `power-exit migrate` orchestrates analyse, assessment report, and all generators from one validated IR in a single deterministic pipeline.
25. Master migrate output includes `migration-plan.md` and combined `generation-plan.json`/`generation-plan.md` for human-in-the-loop review.
26. `migrate --dry-run` is report/plan-focused and does not emit non-report scaffold code artifacts.
27. Readiness gating is deterministic and explainable (`pass` | `warn` | `fail`) and emits both machine-readable JSON and markdown rationale.
28. Readiness gate defaults are conservative (`maxRiskScore=70`, `maxComplexityScore=70`, `minConfidence=0.60`, `allowCriticalUnsupported=false`, `maxUnresolvedDependencies=6`, `maxHighSeverityFindings=8`, `requireNoBlockers=true`).
29. Gate output is advisory unless `power-exit gate --ci` is used; CI mode enforces pass/fail policy by exit code.
30. `--strict` only affects CI exit behavior for warn states (warn becomes non-zero in CI strict mode).
31. Policy-driven gate profiles are versioned (`schemaVersion=1.0`) and resolved by deterministic precedence: built-in defaults -> policy profile -> CLI threshold flags.
32. Policy profiles are environment-oriented (`dev`, `test`, `prod`, `strict`) and should be treated as governance posture, not deployment automation.
33. Waivers are audit metadata (`allowedWaivers[]`) and never remove gate evidence; waived items remain visible in JSON/markdown with waiver references.
34. Critical waiver targets require `riskAccepted=true`; expired or invalid waivers are ignored and surfaced as warnings in gate audit output.

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
- Canvas layout normalization preserves raw layout properties and derives best-effort normalized layout mode/responsive hints.
- Flow malformed JSON/XML files produce warnings and parsing continues for remaining flows.
- Flow trigger/action parsing is best-effort and preserves raw inputs/expressions without execution.
- Assessment scoring is deterministic and explainable, using explicit weighted heuristics over current IR signals.
- Generator outputs are deterministic and generated only from validated IR, never from raw source files.
- SQL generation emits explicit warnings/unsupported features when mapping confidence is insufficient.
- React skeleton generation preserves formulas as comments/TODO handlers and surfaces unsupported controls as visible placeholders.
- React generation now emits deterministic formula hotspot planning metadata for manual migration handoff.
- SQL generation now emits deterministic SQL plan metadata (tables/columns/FKs/join tables/unresolved/collisions) for review.
- Azure Functions generation emits deterministic functions planning metadata (planned functions, adapter files, connector mappings, trigger strategy, handler signatures, unsupported actions, unresolved dependencies, unresolved adapter requirements, deployment readiness, manual hotspots).
- End-to-end migrate flow emits combined deterministic planning metadata across SQL/React/Functions/Infra in one master generation plan.
- Flow expressions and canvas formulas are preserved as comments/TODO context, not executed or translated semantically end-to-end.
- Unknown layouts, unresolved dependencies, and malformed artifacts reduce confidence and increase risk by design.
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
8. Control roles and readiness states are confidence-scored heuristics intended to prioritize future React migration work, not to auto-generate UI code yet.
9. Cloud Flow IR preserves trigger/action graphs, connector and expression references, and readiness heuristics without executing expressions.
10. Assessment outputs are planning guidance (findings, blockers, quick wins, migration waves), not a guarantee of zero-effort migration.
