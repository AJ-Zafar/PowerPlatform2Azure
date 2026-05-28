# Unsupported Features

This document is the canonical catalog of Power Platform features currently not supported by the Power Exit MVP parser and generator pipeline.

Each unsupported feature entry should include:

- Source artefact type.
- Detection pattern.
- Impact on migration fidelity.
- Parser handling behavior.
- Suggested mitigation or manual migration path.

Detailed entries are added as parser milestones are implemented.

## Current hardening-pass unsupported categories

1. `solution.unknown-file-layout`
   - Trigger: files discovered outside recognized unpacked solution layout buckets.
   - Handling: warning + unsupported record; file is excluded from semantic parsing.

2. `dataverse.attribute-type.<type>`
   - Trigger: Dataverse attribute type not in the supported normalized type map.
   - Handling: attribute retained as `unknown` type where possible, with warning and unsupported record.

3. `canvas.control-type.<type>`
   - Trigger: Canvas control type is not in the current known control map.
   - Handling: control is preserved in IR with warning + unsupported record; downstream mapping must treat it as manual/unknown.

4. `canvas.unknown-source-shape`
   - Trigger: Canvas source file is discoverable but not parseable into known app/screen/component/control/formula/resource shape.
   - Handling: warning emitted; parse continues without crashing.

5. `canvas.layout.unknown`
   - Trigger: control layout properties do not map to known normalized layout modes.
   - Handling: control is preserved; normalized layout mode set to `unknown` with warning-ready metadata.

6. `canvas.control-role.unknown`
   - Trigger: control type/name does not map to a known migration role.
   - Handling: control is preserved with role `unknown`; readiness can degrade to `blocked`.

7. `flow.action.unsupported-type.<type>`
   - Trigger: Cloud Flow action type is not in the supported action map.
   - Handling: action is retained in flow inventory with warning + unsupported record; readiness can degrade to `blocked`.

8. `flow.file.unsupported-format`
   - Trigger: workflow file under `workflows/` is not JSON/XML/XAML.
   - Handling: warning emitted; parser continues with other flow files.

9. `flow.reference.unresolved.*`
   - Trigger: runAfter, connection reference, Dataverse entity, or expression reference cannot be resolved to known artifacts.
   - Handling: unresolved dependency edge + warning; parse continues.

10. `dataverse.entity.virtual-table`
    - Trigger: entity ownership/shape indicates virtual table semantics.
    - Handling: SQL generator emits unsupported feature + warning; DDL can still be emitted as a starter.

11. `dataverse.column.calculated`
    - Trigger: Dataverse column appears to be calculated.
    - Handling: SQL generator emits unsupported feature + warning; manual computed-column/view strategy required.

12. `dataverse.column.rollup`
    - Trigger: Dataverse column appears to be rollup/aggregate-driven.
    - Handling: SQL generator emits unsupported feature + warning; manual aggregation strategy required.

13. `dataverse.column.file`
    - Trigger: Dataverse file-style column detected.
    - Handling: SQL generator emits unsupported feature + warning; external blob/object storage design required.

14. `dataverse.column.image`
    - Trigger: Dataverse image-style column detected.
    - Handling: SQL generator emits unsupported feature + warning; external asset handling required.

15. `dataverse.column.activityparty`
    - Trigger: partylist/activityparty-style column detected.
    - Handling: SQL generator emits unsupported feature + warning; manual polymorphic association modeling required.

16. `dataverse.polymorphic-lookup.customer`
    - Trigger: customer/polymorphic lookup semantics detected.
    - Handling: SQL generator emits unsupported feature + warning; manual relationship decomposition required.

17. `dataverse.column.unknown`
    - Trigger: unknown Dataverse column type remains after parsing.
    - Handling: SQL generator emits unsupported feature + warning; fallback SQL type is explicit and review-required.

18. `canvas.control-role.html`
    - Trigger: Canvas control role `html` is encountered during React generation.
    - Handling: generator emits unsupported feature + warning and renders a visible TODO placeholder.

19. `canvas.control-role.customComponent`
    - Trigger: Canvas custom component role is encountered during React generation.
    - Handling: generator emits unsupported feature + warning and renders a visible TODO placeholder.

20. `canvas.control-role.unknown`
    - Trigger: Canvas unknown control role is encountered during React generation.
    - Handling: generator emits unsupported feature + warning and renders a visible TODO placeholder.

21. `canvas.formula.manual-conversion-required`
    - Trigger: Canvas Power Fx formulas are preserved in generated React output.
    - Handling: formulas are emitted as TODO comments/handler stubs; no automatic TypeScript translation is attempted.

22. `generation.file-conflict-skipped`
    - Trigger: output file already exists and differs from planned generated content while `--force` is not set.
    - Handling: generation plan marks file action as `skip`, emits a warning/manual review item, and does not overwrite the file.

23. `generation.clean-unmarked-file-preserved`
    - Trigger: `--clean` is used and a file does not contain the Power Exit generated-file marker.
    - Handling: file is preserved and may still conflict during generation; review `generation-plan.json` skipped files.

24. `flow.trigger.<classification>.manual-functions-mapping`
    - Trigger: Azure Functions scaffold generation encounters trigger classifications that are not directly mapped to production-ready runtime semantics (`dataverse`, `email`, `unknown` etc.).
    - Handling: function stubs include TODO placeholders, warnings are emitted, and manual review hotspots are added.

25. `flow.action.unsupported-for-functions-scaffold`
    - Trigger: Cloud Flow action type does not have a deterministic scaffold mapping.
    - Handling: unsupported action TODO is emitted in generated function, warning + unsupported feature are recorded.

26. `functions.canvas.unresolved-datasource`
    - Trigger: Canvas formula data-operation hotspot lacks resolvable data source binding.
    - Handling: warning + manual hotspot are emitted and handler is routed to manual-review scaffold grouping.

27. `functions.trigger.placeholder-http-fallback`
    - Trigger: Flow trigger classification (`dataverse`, `email`, `event`, unknown) cannot be deterministically bound to a production trigger in scaffold mode.
    - Handling: generator emits queue/webhook/event-grid guidance comments and a safe HTTP/manual fallback handler plus warning/manual review hotspot.

28. `functions.adapter.manual-contract-required`
    - Trigger: Connector/action mapping needs an adapter method but production request/response contracts are unresolved.
    - Handling: typed adapter interface + TODO method are generated with no live calls/credentials; unresolved adapter requirements are added to `functionsPlan`.

29. `functions.packaging.missing-scaffold-entry`
    - Trigger: Expected scaffold files/directories (`package.json`, `host.json`, `tsconfig.json`, `local.settings.example.json`, `src/functions`, `src/services`, `src/adapters`, `src/utils`) are missing.
    - Handling: packaging validation emits warnings so deployment cannot be treated as ready.

30. `infra.missing-solution-metadata`
    - Trigger: IR solution metadata is placeholder/unknown and cannot provide reliable naming conventions.
    - Handling: infra generator emits warning + blocked deployment readiness flag in `infraPlan`.

31. `infra.no-workload-detected`
    - Trigger: IR does not indicate SQL/React/Functions workload requirements.
    - Handling: infra generator emits warning and produces placeholder-only scaffold paths for manual review.

32. `infra.security.manual-review-required`
    - Trigger: infra scaffold generation always requires human hardening for networking, identity, RBAC, monitoring, backup, and promotion policy.
    - Handling: generator emits explicit security manual review items in `infraPlan` and migration notes.

33. `migrate.dry-run.scaffold-not-emitted`
    - Trigger: `power-exit migrate` is executed with `--dry-run`.
    - Handling: migrate performs full planning/assessment but emits report/plan outputs only; non-report scaffold artifacts are intentionally not written.

34. `migrate.master-plan.requires-human-review`
    - Trigger: combined generation plan includes skipped files, unresolved dependencies, unsupported features, or high-severity review items.
    - Handling: migrate emits master `generation-plan.*` and `migration-plan.md` to drive manual approval/remediation workflow.

35. `gate.input.generation-plan-missing`
    - Trigger: `power-exit gate` runs without `generation-plan.json` in the output folder.
    - Handling: gate evaluation falls back to IR + assessment signals and emits a high-severity manual review item so status is warn/fail explainably.

36. `gate.threshold.unresolved-dependencies`
    - Trigger: unresolved dependency count exceeds `maxUnresolvedDependencies`.
    - Handling: gate emits explicit warn/fail reason with threshold overage and includes unresolved dependency details in JSON/markdown outputs.

37. `gate.threshold.critical-unsupported-disallowed`
    - Trigger: critical unsupported features are present while `allowCriticalUnsupported=false`.
    - Handling: gate status becomes `fail` with explicit blocking rationale.

38. `gate.ci.strict-warn-failure`
    - Trigger: `power-exit gate --ci --strict` returns status `warn`.
    - Handling: command exits non-zero to enforce warn-as-fail CI policy.

## Current parser limitations

- Flow parsing is heuristic and best-effort for common unpacked JSON + XML metadata shapes.
- Flow parser does not execute expressions and does not evaluate runtime conditions/scopes.
- Flow connector premium/custom classification is pattern-based and may require manual confirmation.
- Flow readiness metadata is preparatory and not a full migration assessment score.
- Assessment scores are deterministic heuristics and should be treated as migration planning guidance, not guaranteed conversion success.
- Assessment recommendations/waves do not execute remediation; they identify prioritized next actions with current evidence.
- SQL DDL generation is deterministic but intentionally conservative; unsupported records indicate required manual schema/application design.
- React skeleton generation is deterministic and conservative; unsupported controls are placeholders and require manual conversion.
- React generator does not use AI/external model APIs and does not perform semantic Power Fx translation in this pass.
- Dry-run mode is planning-only and intentionally does not emit generated SQL/React artifacts.
- Dry-run mode is planning-only and intentionally does not emit generated Functions scaffold artifacts.
- Dry-run mode is planning-only and intentionally does not emit generated infra/Bicep scaffold artifacts.
- Migrate dry-run intentionally emits only report/plan artifacts and never claims deployment-ready outputs.
- Safe-write mode can leave skipped files that require manual conflict resolution or explicit `--force`.
- Readiness gate output is advisory unless CI mode (`--ci`) is explicitly used.
- Azure Functions output is scaffold-only: trigger/action handlers, service adapters, and auth/validation flows are placeholders.
- Azure infra output is scaffold-only: resources are placeholders with no deployment execution, no live credentials, and explicit manual hardening TODOs.
- Canvas parsing does not execute or semantically evaluate Power Fx; it preserves raw formulas and extracts best-effort references only.
- Canvas layout normalization and role classification are heuristic and may require manual review for complex apps.
- Canvas readiness scoring is preparatory metadata and not a full migration assessment score.
- Canvas dependency extraction is best-effort and can emit unresolved references for ambiguous formulas and data bindings.
- Dependency edges are best-effort from currently parsed artifacts and discoverable references in source files.
- Summary counts are parser telemetry only and are not equivalent to assessment scores.
