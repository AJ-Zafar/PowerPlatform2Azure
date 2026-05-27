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

## Current parser limitations

- Flow and Canvas semantic parsing are not implemented yet; only lightweight inventory/dependency detection is available.
- Dependency edges are best-effort from currently parsed artifacts and discoverable references in source files.
- Summary counts are parser telemetry only and are not equivalent to assessment scores.
