# Power Exit MVP GitHub Issue Backlog

This document is the canonical MVP backlog definition for GitHub issues.

## Prioritisation model

Prioritisation is based on:

1. Architectural dependency order (IR before parsers; parsers before assessment/generators; generators before CLI orchestration).
2. Lowest implementation risk first (scaffolding, contracts, fixtures, deterministic primitives).
3. Highest leverage foundation work first (tooling, shared contracts, CI, and fixture harness).

## Recommended execution order (global queue)

1. M1-01, M1-02, M1-03, M1-04, M1-05, M1-06
2. M2-01, M2-02, M2-03, M2-04, M2-05
3. M3-01, M3-02, M3-03, M3-04
4. M4-01, M4-02, M4-03, M4-04, M4-05, M4-06, M4-07
5. M5-01, M5-02, M5-03, M5-04, M5-05, M5-06
6. M6-01, M6-02, M6-03, M6-04
7. M7-01, M7-02, M7-03, M7-04, M7-05
8. M8-01, M8-02, M8-03, M8-04
9. M9-01, M9-02, M9-03
10. M10-01, M10-02, M10-03

---

## MILESTONE 1 — Foundation

### M1-01 — Initial monorepo scaffolding and workspace bootstrap
- **Implementation objective:** Establish root workspace configuration, package boundaries, root scripts, and package-level TypeScript projects for `apps/*` and `packages/*`.
- **Acceptance criteria:**
  - Root workspace installs successfully with one lockfile.
  - Root scripts exist for lint, typecheck, test, build, verify.
  - All target packages/apps compile as empty scaffolds.
- **Technical notes:** Use npm workspaces, TypeScript project references, strict compiler defaults.
- **Required tests:** Run root `lint`, `typecheck`, `test`, `build`.
- **Dependencies:** none.
- **Impacted packages:** root, `apps/cli`, `apps/web`, `packages/*`.

### M1-02 — Shared TypeScript base and deterministic tooling settings
- **Implementation objective:** Standardize strict TS defaults, output conventions, and deterministic ordering helpers used by parsers/generators.
- **Acceptance criteria:**
  - Shared tsconfig base is consumed by all packages.
  - Deterministic helpers exported from a shared utility module.
  - CI enforces deterministic helper tests.
- **Technical notes:** Keep utility module minimal and explicit.
- **Required tests:** Unit tests for sort/stability helpers and schema-safe utility types.
- **Dependencies:** M1-01.
- **Impacted packages:** root, `packages/ir` (or shared util module).

### M1-03 — Linting and formatting baseline
- **Implementation objective:** Define ESLint baseline that enforces strict TS hygiene and disallows unsafe parser shortcuts.
- **Acceptance criteria:**
  - Lint config committed and documented.
  - CI fails on lint errors.
  - Rules include no `any` and no unused vars without explicit suppression.
- **Technical notes:** Keep rule set small; no style bike-shedding rules.
- **Required tests:** Lint run across repo and sample violation test.
- **Dependencies:** M1-01.
- **Impacted packages:** root.

### M1-04 — Test harness and fixture test utilities
- **Implementation objective:** Introduce Vitest harness and reusable fixture-loading test utilities.
- **Acceptance criteria:**
  - Vitest config supports package-level tests.
  - Fixture loading helper reads files deterministically.
  - Example test demonstrates fixture helper use.
- **Technical notes:** Use UTF-8 and stable path normalization.
- **Required tests:** Vitest run with at least one passing fixture helper test.
- **Dependencies:** M1-01.
- **Impacted packages:** root, `packages/fixtures`.

### M1-05 — CI pipeline skeleton and quality gates
- **Implementation objective:** Add GitHub Actions workflow to execute lint/typecheck/test/build on push and PR.
- **Acceptance criteria:**
  - CI workflow exists and runs on `main` and feature branches.
  - Failing quality gate blocks workflow.
  - Cache strategy is defined.
- **Technical notes:** Keep workflow explicit; avoid matrix complexity in MVP.
- **Required tests:** Local dry run equivalent with root `verify`.
- **Dependencies:** M1-01, M1-03, M1-04.
- **Impacted packages:** root.

### M1-06 — Shared parser result contract helpers
- **Implementation objective:** Provide helpers for standard parser envelope (`data`, `warnings`, `unsupported`, `confidence`) and typed factories.
- **Acceptance criteria:**
  - Shared factory functions for parser result and issue records exist.
  - Contract is consumed by at least one parser stub.
  - Confidence bounds validated.
- **Technical notes:** Keep implementation in `packages/ir` until dedicated shared package is justified.
- **Required tests:** Unit tests for envelope construction and confidence bound enforcement.
- **Dependencies:** M2-01.
- **Impacted packages:** `packages/ir`, `packages/parsers`.

---

## MILESTONE 2 — Intermediate Representation

### M2-01 — Define PowerPlatformIR root schema
- **Implementation objective:** Create root IR schema and TypeScript types with Zod.
- **Acceptance criteria:**
  - Zod schema for solution root, metadata, and artefact collections.
  - Inferred TS types exported.
  - Schema parse errors are structured and traceable.
- **Technical notes:** Keep top-level schema focused; defer deep parser-specific fields to sub-schemas.
- **Required tests:** Schema validation success/failure fixtures.
- **Dependencies:** M1-01.
- **Impacted packages:** `packages/ir`.

### M2-02 — Warning model schema
- **Implementation objective:** Define normalized warning schema including source location and remediation hint fields.
- **Acceptance criteria:**
  - Warning enum/category model documented.
  - Source provenance (file path + optional node id) is mandatory.
  - Parser contract references warning model.
- **Technical notes:** Warning categories should remain broad and stable.
- **Required tests:** Validation tests for warning payloads and required provenance fields.
- **Dependencies:** M2-01.
- **Impacted packages:** `packages/ir`.

### M2-03 — Unsupported feature model schema
- **Implementation objective:** Define unsupported-feature record schema with severity and migration impact.
- **Acceptance criteria:**
  - Unsupported record includes feature key, source, severity, impact text.
  - Unknown unsupported payloads fail schema validation.
  - Report generator contract references this schema.
- **Technical notes:** Include deterministic feature key naming convention.
- **Required tests:** Schema tests for valid/invalid unsupported entries.
- **Dependencies:** M2-01.
- **Impacted packages:** `packages/ir`, `packages/generators`.

### M2-04 — Confidence scoring primitives
- **Implementation objective:** Implement reusable confidence score primitives and aggregation input model.
- **Acceptance criteria:**
  - Confidence value bounded to `0..1`.
  - Primitive score components support weighted aggregation.
  - Parser envelope requires confidence.
- **Technical notes:** Keep primitive math transparent and testable.
- **Required tests:** Boundary tests (0, 1, below 0, above 1) and weighted aggregation tests.
- **Dependencies:** M2-01.
- **Impacted packages:** `packages/ir`, `packages/assessment`.

### M2-05 — IR provenance metadata contract
- **Implementation objective:** Define provenance schema used by all generated artefacts and parser records.
- **Acceptance criteria:**
  - Provenance includes source file path(s), extraction timestamp, tool version.
  - Generators accept and emit provenance block.
  - Provenance schema is reusable across outputs.
- **Technical notes:** Timestamp format must be ISO-8601 UTC.
- **Required tests:** Schema tests and snapshot of provenance serialization.
- **Dependencies:** M2-01.
- **Impacted packages:** `packages/ir`, `packages/generators`.

---

## MILESTONE 3 — Solution Discovery

### M3-01 — Solution folder scanner
- **Implementation objective:** Recursively discover candidate Power Platform solution folders with deterministic traversal.
- **Acceptance criteria:**
  - Scanner accepts root path and returns sorted candidates.
  - Non-solution directories are excluded with explicit reasons.
  - Scanner emits warnings when expected markers are missing.
- **Technical notes:** Stable sort by normalized relative path.
- **Required tests:** Fixture-based scanner tests with mixed directory trees.
- **Dependencies:** M1-04, M2-01.
- **Impacted packages:** `packages/parsers`, `packages/fixtures`.

### M3-02 — Solution manifest parsing
- **Implementation objective:** Parse solution manifest metadata into IR discovery section.
- **Acceptance criteria:**
  - Manifest parser reads known solution metadata fields.
  - Unknown fields surface as warnings, not silent drops.
  - Parse output follows parser envelope contract.
- **Technical notes:** Keep XML/JSON parsing adapters isolated.
- **Required tests:** Valid manifest, malformed manifest, and unknown-field fixtures.
- **Dependencies:** M3-01, M2-02, M2-04.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M3-03 — File classification index
- **Implementation objective:** Classify discovered files into Dataverse, Canvas, Flow, and auxiliary categories.
- **Acceptance criteria:**
  - Classifier output contains category, confidence, provenance.
  - Ambiguous files produce warnings.
  - Unknown file patterns produce unsupported records.
- **Technical notes:** Classification rules should be table-driven.
- **Required tests:** Fixture matrix covering known, ambiguous, and unknown classes.
- **Dependencies:** M3-01, M2-03, M2-04.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M3-04 — Dependency graph discovery
- **Implementation objective:** Build initial dependency graph across discovered artefacts.
- **Acceptance criteria:**
  - Graph nodes and edges are deterministic.
  - Missing references are warnings.
  - Cycles are detected and surfaced.
- **Technical notes:** Graph model should support later parser enrichment.
- **Required tests:** Graph fixture tests for edge extraction, missing nodes, and cycles.
- **Dependencies:** M3-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/assessment`.

---

## MILESTONE 4 — Dataverse Parsing

### M4-01 — Dataverse entity metadata parser
- **Implementation objective:** Parse table/entity definitions into IR entities collection.
- **Acceptance criteria:** Entity logical name, display name, ownership type, and provenance are captured.
- **Technical notes:** Keep entity parser independent from attribute parser.
- **Required tests:** Fixture tests for standard and custom entities.
- **Dependencies:** M3-03, M2-01.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/fixtures`.

### M4-02 — Dataverse columns/attributes parser
- **Implementation objective:** Parse column metadata (types, nullability, constraints, default behavior).
- **Acceptance criteria:** Columns link to entity ids and capture source metadata with confidence.
- **Technical notes:** Unknown attribute types generate unsupported records.
- **Required tests:** Fixtures for primitive, lookup, and unsupported attribute types.
- **Dependencies:** M4-01, M2-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M4-03 — Dataverse relationships parser
- **Implementation objective:** Parse one-to-many, many-to-one, and many-to-many relationships.
- **Acceptance criteria:** Relationship endpoints and cardinality are represented in IR.
- **Technical notes:** Missing targets should produce warnings and reduced confidence.
- **Required tests:** Relationship fixtures including unresolved references.
- **Dependencies:** M4-01, M4-02.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M4-04 — Option sets and choices parser
- **Implementation objective:** Parse global/local option sets and choice values.
- **Acceptance criteria:** Value-label mappings and default values are captured.
- **Technical notes:** Include deterministic value sorting in output.
- **Required tests:** Fixtures for global options, local choices, and duplicate labels.
- **Dependencies:** M4-02.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M4-05 — Environment variables parser
- **Implementation objective:** Parse Dataverse environment variable definitions and current values.
- **Acceptance criteria:** Variable schema and value records are linked and provenance-tagged.
- **Technical notes:** Secret-like values should be flagged for secure handling metadata.
- **Required tests:** Fixtures for defined-only, value-only, and mismatched variable records.
- **Dependencies:** M3-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/assessment`.

### M4-06 — Connection references parser
- **Implementation objective:** Parse connection references and dependent components.
- **Acceptance criteria:** Connector id, display name, and dependent artefacts are captured.
- **Technical notes:** Missing connector metadata generates warnings.
- **Required tests:** Fixtures for valid and orphaned connection references.
- **Dependencies:** M3-03, M3-04.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M4-07 — Security roles inventory parser
- **Implementation objective:** Parse security role metadata and privilege inventory for assessment reporting.
- **Acceptance criteria:** Roles, privilege scopes, and unresolved principals are represented.
- **Technical notes:** MVP is inventory-only; no permission translation generation.
- **Required tests:** Fixtures for standard role definitions and custom privilege scopes.
- **Dependencies:** M3-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/assessment`.

---

## MILESTONE 5 — Canvas Parsing

### M5-01 — Canvas source discovery
- **Implementation objective:** Discover Canvas app sources and normalize source map entries.
- **Acceptance criteria:** Canvas source files are indexed with deterministic ordering.
- **Technical notes:** Reuse milestone 3 file classification metadata.
- **Required tests:** Fixture tests for multiple canvas app directories.
- **Dependencies:** M3-03.
- **Impacted packages:** `packages/parsers`, `packages/fixtures`.

### M5-02 — Canvas screen extraction
- **Implementation objective:** Extract screen-level inventory and screen metadata.
- **Acceptance criteria:** Screen names, ids, and source links are captured in IR.
- **Technical notes:** Unknown screen block formats are unsupported records.
- **Required tests:** Screen extraction fixtures with malformed screen blocks.
- **Dependencies:** M5-01, M2-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M5-03 — Canvas control extraction
- **Implementation objective:** Extract control inventory per screen with control hierarchy.
- **Acceptance criteria:** Control type, id, parent-child relationships are captured.
- **Technical notes:** Preserve source order for deterministic inventory output.
- **Required tests:** Fixtures for nested controls and unknown control types.
- **Dependencies:** M5-02.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M5-04 — Layout metadata extraction
- **Implementation objective:** Capture layout metadata (positioning model, responsive hints, container structures).
- **Acceptance criteria:** Layout metadata linked to control and screen records.
- **Technical notes:** MVP keeps raw layout fields, no normalization beyond typing.
- **Required tests:** Fixtures for container layout and absolute positioning variants.
- **Dependencies:** M5-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M5-05 — Raw Power Fx formula extraction
- **Implementation objective:** Extract and preserve raw Power Fx expressions from controls and screens.
- **Acceptance criteria:** Formula text is preserved exactly with provenance and owning control/screen id.
- **Technical notes:** Do not attempt semantic translation in MVP.
- **Required tests:** Fixtures covering multiline formulas and escaped characters.
- **Dependencies:** M5-03, M5-04.
- **Impacted packages:** `packages/parsers`, `packages/powerfx`, `packages/ir`.

### M5-06 — Canvas component inventory
- **Implementation objective:** Inventory reusable canvas components and references.
- **Acceptance criteria:** Component definitions and usage references are linked.
- **Technical notes:** Unknown component contract fields become warnings.
- **Required tests:** Fixtures for reusable component definitions and missing references.
- **Dependencies:** M5-01, M5-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/assessment`.

---

## MILESTONE 6 — Flow Parsing

### M6-01 — Cloud flow inventory and trigger parsing
- **Implementation objective:** Inventory cloud flows and parse trigger definitions.
- **Acceptance criteria:** Flow id/name and trigger type/provider are captured.
- **Technical notes:** Unsupported trigger types produce unsupported entries.
- **Required tests:** Fixtures for HTTP, schedule, and Dataverse triggers.
- **Dependencies:** M3-03, M2-03.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M6-02 — Action graph parsing
- **Implementation objective:** Parse flow actions into a deterministic directed graph.
- **Acceptance criteria:** Action nodes and dependencies are represented in IR.
- **Technical notes:** Preserve original action order plus explicit dependency edges.
- **Required tests:** Fixtures for branching and parallel action definitions.
- **Dependencies:** M6-01.
- **Impacted packages:** `packages/parsers`, `packages/ir`.

### M6-03 — Connector analysis
- **Implementation objective:** Analyze flow connector usage and normalize connector inventory.
- **Acceptance criteria:** Connector list includes action references and connector category.
- **Technical notes:** Unknown connectors should reduce confidence.
- **Required tests:** Fixtures with first-party and custom connectors.
- **Dependencies:** M6-02, M4-06.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/assessment`.

### M6-04 — Flow dependency extraction
- **Implementation objective:** Extract flow dependencies on Dataverse entities, connections, and environment variables.
- **Acceptance criteria:** Dependencies are linked into shared dependency graph model.
- **Technical notes:** Reuse milestone 3 graph structure.
- **Required tests:** Fixtures validating dependency edge correctness.
- **Dependencies:** M6-02, M3-04, M4-05, M4-06.
- **Impacted packages:** `packages/parsers`, `packages/ir`, `packages/assessment`.

---

## MILESTONE 7 — Assessment Engine

### M7-01 — Complexity scoring engine
- **Implementation objective:** Implement migration complexity scoring from IR dimensions.
- **Acceptance criteria:** Complexity score includes weighted factors and rationale.
- **Technical notes:** Keep factor weights configurable via typed config.
- **Required tests:** Unit tests for scoring factors and fixture-based integration tests.
- **Dependencies:** M2-04, M4-01..M4-07, M5-01..M5-06, M6-01..M6-04.
- **Impacted packages:** `packages/assessment`, `packages/ir`.

### M7-02 — Migration risk scoring
- **Implementation objective:** Implement risk scoring based on unsupported features and dependency fragility.
- **Acceptance criteria:** Risk score and top risk contributors are emitted.
- **Technical notes:** Risk model should reference unsupported severity and confidence.
- **Required tests:** Fixtures for low, medium, and high risk scenarios.
- **Dependencies:** M2-03, M7-01.
- **Impacted packages:** `packages/assessment`, `packages/ir`.

### M7-03 — Unsupported feature reporting aggregator
- **Implementation objective:** Aggregate unsupported records across all parsers into report-ready structure.
- **Acceptance criteria:** Aggregation includes counts, categories, and source provenance.
- **Technical notes:** Output order must be stable.
- **Required tests:** Snapshot tests for deterministic unsupported reports.
- **Dependencies:** M4-01..M6-04.
- **Impacted packages:** `packages/assessment`, `packages/ir`.

### M7-04 — Confidence aggregation engine
- **Implementation objective:** Aggregate parser confidence values into solution-level confidence summary.
- **Acceptance criteria:** Summary includes per-domain confidence and overall weighted score.
- **Technical notes:** Missing domains should affect weighting explicitly.
- **Required tests:** Boundary and weighted aggregation tests.
- **Dependencies:** M2-04, M4-01..M6-04.
- **Impacted packages:** `packages/assessment`, `packages/ir`.

### M7-05 — Migration recommendation engine
- **Implementation objective:** Produce actionable migration recommendations from complexity/risk/confidence outputs.
- **Acceptance criteria:** Recommendations include rationale, priority, and linked evidence.
- **Technical notes:** Keep recommendation logic rule-based for MVP.
- **Required tests:** Fixture scenarios validating recommendation selection.
- **Dependencies:** M7-01, M7-02, M7-03, M7-04.
- **Impacted packages:** `packages/assessment`.

---

## MILESTONE 8 — Generators

### M8-01 — IR JSON output generator
- **Implementation objective:** Generate normalized IR JSON artefact with provenance metadata.
- **Acceptance criteria:** Output is schema-valid and deterministic.
- **Technical notes:** Use stable key ordering and deterministic array ordering.
- **Required tests:** Snapshot tests across repeated runs.
- **Dependencies:** M2-01..M2-05, M7-04.
- **Impacted packages:** `packages/generators`, `packages/ir`.

### M8-02 — Markdown assessment report generator
- **Implementation objective:** Generate markdown report covering findings, risks, confidence, and recommendations.
- **Acceptance criteria:** Report includes unsupported matrix and provenance section.
- **Technical notes:** Keep format friendly for PR comments and docs.
- **Required tests:** Snapshot tests for markdown structure and deterministic ordering.
- **Dependencies:** M7-01..M7-05.
- **Impacted packages:** `packages/generators`, `packages/assessment`.

### M8-03 — Azure SQL DDL generator
- **Implementation objective:** Generate Azure SQL DDL from Dataverse entities/columns/relationships.
- **Acceptance criteria:** Tables, columns, PK/FK, and option mappings are represented.
- **Technical notes:** Generate only from IR, never from raw source files.
- **Required tests:** Fixture-to-DDL snapshot tests and deterministic repeatability tests.
- **Dependencies:** M4-01..M4-04, M8-01.
- **Impacted packages:** `packages/generators`, `packages/ir`.

### M8-04 — React screen skeleton generator
- **Implementation objective:** Generate basic React screen skeletons from canvas screen/control inventory.
- **Acceptance criteria:** Screen components map from inventory and preserve source provenance comments.
- **Technical notes:** Inventory-driven skeletons only; no semantic UI translation in MVP.
- **Required tests:** Fixture snapshot tests for generated screen skeleton files.
- **Dependencies:** M5-02..M5-06, M8-01.
- **Impacted packages:** `packages/generators`, `packages/ir`.

---

## MILESTONE 9 — CLI

### M9-01 — `analyse` command
- **Implementation objective:** Implement CLI command that runs discovery, parsing, and assessment pipeline.
- **Acceptance criteria:** Command accepts input path and writes structured outputs.
- **Technical notes:** Provide explicit non-zero exit codes for failures.
- **Required tests:** CLI integration tests with fixture solutions.
- **Dependencies:** M3-01..M7-05.
- **Impacted packages:** `apps/cli`, `packages/parsers`, `packages/assessment`, `packages/generators`.

### M9-02 — report generation command
- **Implementation objective:** Implement CLI command to generate markdown report from IR.
- **Acceptance criteria:** Command reads IR artefact and writes markdown report.
- **Technical notes:** Validate input IR schema before generation.
- **Required tests:** CLI integration tests for report output paths and failures.
- **Dependencies:** M8-01, M8-02.
- **Impacted packages:** `apps/cli`, `packages/generators`, `packages/ir`.

### M9-03 — generator commands
- **Implementation objective:** Implement CLI subcommands for Azure SQL and React skeleton generation.
- **Acceptance criteria:** Commands support output directory and deterministic overwrite behavior.
- **Technical notes:** Include `--dry-run` output plan for traceability.
- **Required tests:** CLI integration tests for SQL and React generation.
- **Dependencies:** M8-03, M8-04.
- **Impacted packages:** `apps/cli`, `packages/generators`.

---

## MILESTONE 10 — Validation

### M10-01 — Fixture coverage expansion
- **Implementation objective:** Build comprehensive fixture corpus spanning supported and unsupported scenarios.
- **Acceptance criteria:** Every parser domain has baseline, edge, and unsupported fixtures.
- **Technical notes:** Keep fixtures small and readable; avoid overfitting.
- **Required tests:** Fixture completeness checks and parser integration runs.
- **Dependencies:** M4-01..M6-04.
- **Impacted packages:** `packages/fixtures`, `packages/parsers`, `packages/powerfx`.

### M10-02 — Snapshot test suite for outputs
- **Implementation objective:** Add snapshot coverage for IR JSON, markdown report, SQL DDL, and React skeleton outputs.
- **Acceptance criteria:** Snapshots are stable across repeated runs.
- **Technical notes:** Normalize timestamps when necessary to keep deterministic snapshots.
- **Required tests:** Snapshot test suite in CI for all generators.
- **Dependencies:** M8-01..M8-04.
- **Impacted packages:** `packages/generators`, `packages/assessment`, `packages/fixtures`.

### M10-03 — Deterministic output validation harness
- **Implementation objective:** Implement repeat-run deterministic validator that compares output hashes across multiple runs.
- **Acceptance criteria:** CI fails when deterministic outputs diverge.
- **Technical notes:** Include fixed seed and normalized environment data.
- **Required tests:** Determinism integration tests (multi-run compare).
- **Dependencies:** M10-02, M9-01..M9-03.
- **Impacted packages:** root, `packages/generators`, `apps/cli`.
