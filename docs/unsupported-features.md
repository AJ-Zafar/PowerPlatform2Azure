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

## Current parser limitations

- Flow parsing is heuristic and best-effort for common unpacked JSON + XML metadata shapes.
- Flow parser does not execute expressions and does not evaluate runtime conditions/scopes.
- Flow connector premium/custom classification is pattern-based and may require manual confirmation.
- Flow readiness metadata is preparatory and not a full migration assessment score.
- Assessment scores are deterministic heuristics and should be treated as migration planning guidance, not guaranteed conversion success.
- Assessment recommendations/waves do not execute remediation; they identify prioritized next actions with current evidence.
- Canvas parsing does not execute or semantically evaluate Power Fx; it preserves raw formulas and extracts best-effort references only.
- Canvas layout normalization and role classification are heuristic and may require manual review for complex apps.
- Canvas readiness scoring is preparatory metadata and not a full migration assessment score.
- Canvas dependency extraction is best-effort and can emit unresolved references for ambiguous formulas and data bindings.
- Dependency edges are best-effort from currently parsed artifacts and discoverable references in source files.
- Summary counts are parser telemetry only and are not equivalent to assessment scores.
