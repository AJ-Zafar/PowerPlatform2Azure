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
    expect(result.summary.classifiedFiles).toBeGreaterThan(0);
    expect(result.ir.analysisSummary.unresolvedDependencies).toBeGreaterThanOrEqual(0);
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

  it("builds dependency graph edges deterministically", async () => {
    const fixturePath = solutionFixturePath("infra-heavy");
    const result = await analyseSolutionFolder(fixturePath);
    const edgeKeys = result.ir.dependencyGraph.edges.map(
      (edge) => `${edge.sourceArtifactId}:${edge.targetArtifactId}:${edge.dependencyType}`
    );
    const sortedEdgeKeys = [...edgeKeys].sort((left, right) =>
      left.localeCompare(right)
    );

    expect(edgeKeys).toEqual(sortedEdgeKeys);
    expect(
      result.ir.dependencyGraph.edges.some(
        (edge) => edge.dependencyType === "flow-connection-reference"
      )
    ).toBe(true);
  });

  it("marks unresolved dependency edges with warnings", async () => {
    const fixturePath = solutionFixturePath("mixed-partial");
    const result = await analyseSolutionFolder(fixturePath);

    expect(result.summary.unresolvedDependencies).toBeGreaterThan(0);
    expect(
      result.ir.dependencyGraph.edges.some(
        (edge) => edge.resolved === false && Boolean(edge.unresolvedWarning)
      )
    ).toBe(true);
  });
});
