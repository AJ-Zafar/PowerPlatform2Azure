# Migration Mappings

This document tracks deterministic mappings between Power Platform constructs and generated Azure artefacts.

## Mapping philosophy

1. All mappings consume validated `PowerPlatformIR` only.
2. No generator may map directly from raw Power Platform files.
3. Provenance from IR records must be preserved in generated artefact metadata.
4. Serialization of intermediate and final artefacts must remain deterministic.

Planned mapping sections:

1. Dataverse table metadata -> Azure SQL DDL
2. Dataverse options/choices -> lookup and enum mapping strategy
3. Canvas screens and controls -> React screen skeleton primitives
4. Cloud flow triggers/actions -> migration advisory mappings

Mappings are introduced incrementally once parser and IR milestones are complete.
