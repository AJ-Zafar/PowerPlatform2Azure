# AGENTS.md

## Product

This repository is for **Power Exit**, a migration assessment and code generation tool for Power Platform solutions.

The goal is to analyse unpacked Power Platform solution folders, convert them into a typed intermediate representation, and generate Azure-ready migration artefacts.

Do not build a one-shot black-box converter. Build a reliable, testable, human-in-the-loop migration engine.

## Core Architecture

Use this flow:

Power Platform solution source  
→ Parsers  
→ Typed Intermediate Representation  
→ Assessment Engine  
→ Generators  
→ Reports and Azure-ready artefacts

Never generate Azure, React, SQL or Functions code directly from raw Power Platform files. Always go through the IR first.

## MVP Scope

The MVP must support:

- solution folder discovery
- Dataverse table/entity metadata parsing
- Dataverse columns/attributes parsing
- relationships parsing
- option sets/choices parsing
- environment variables
- connection references
- cloud flow inventory
- canvas app inventory
- canvas screens and controls inventory
- raw Power Fx formula extraction
- unsupported feature detection
- confidence scoring
- migration complexity scoring
- Markdown assessment report generation
- Azure SQL DDL generation
- basic React screen skeleton generation

## Technical Rules

- Use TypeScript.
- Use a monorepo structure.
- Use Zod for all IR schema validation.
- Use fixture-based tests.
- Every parser must return:
  - parsed artefacts
  - warnings
  - unsupported features
  - confidence score
- Do not silently ignore unsupported or unknown features.
- Generated output must be deterministic.
- Keep code boring, readable and maintainable.
- Prefer small modules over large files.
- Avoid clever abstractions unless clearly justified.
- Do not add dependencies unless needed and documented.

## Repo Structure

Target structure:

```txt
apps/
  cli/
  web/

packages/
  ir/
  parsers/
  generators/
  assessment/
  powerfx/
  fixtures/

docs/
  assumptions.md
  unsupported-features.md
  migration-mappings.md
