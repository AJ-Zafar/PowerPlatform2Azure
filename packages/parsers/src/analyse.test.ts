import path from "node:path";

import { describe, expect, it } from "vitest";

import { serializeDeterministicIR, validatePowerPlatformIR } from "@power-exit/ir";

import { analyseSolutionFolder } from "./analyse";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("analyseSolutionFolder", () => {
  it("merges discovery, manifest, dataverse, and infrastructure into validated IR", async () => {
    const fixturePath = solutionFixturePath("infra-heavy");
    const result = await analyseSolutionFolder(fixturePath);

    expect(() => validatePowerPlatformIR(result.ir)).not.toThrow();
    expect(result.summary.environmentVariables).toBe(2);
    expect(result.summary.connectionReferences).toBe(2);
    expect(result.summary.securityRoles).toBe(2);
  });

  it("produces deterministic parsing output", async () => {
    const fixturePath = solutionFixturePath("dataverse-heavy");
    const resultA = await analyseSolutionFolder(fixturePath);
    const resultB = await analyseSolutionFolder(fixturePath);

    expect(serializeDeterministicIR(resultA.ir)).toBe(serializeDeterministicIR(resultB.ir));
  });

  it("preserves provenance in merged artifacts", async () => {
    const fixturePath = solutionFixturePath("dataverse-heavy");
    const result = await analyseSolutionFolder(fixturePath);

    expect(result.ir.dataverse.entities[0]?.provenance.sourceType).toBe("dataverse");
    expect(result.ir.solution.provenance.sourceType).toBe("solution");
  });
});
