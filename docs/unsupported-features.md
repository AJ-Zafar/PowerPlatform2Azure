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

## Current parser limitations

- Flow semantic parsing is not implemented yet.
- Canvas parsing does not execute or semantically evaluate Power Fx; it preserves raw formulas and extracts best-effort references only.
- Canvas dependency extraction is best-effort and can emit unresolved references for ambiguous formulas.
- Dependency edges are best-effort from currently parsed artifacts and discoverable references in source files.
- Summary counts are parser telemetry only and are not equivalent to assessment scores.
