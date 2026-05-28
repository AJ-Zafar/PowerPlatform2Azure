import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEmptyPowerPlatformIR,
  validatePowerPlatformIR,
  type PowerPlatformIR
} from "@power-exit/ir";

import {
  generateAzureInfraArtifacts,
  generateAzureInfraFromPowerPlatformIR
} from "./index";

interface InfraFixtureCase {
  solution: {
    name: string;
    uniqueName: string;
    publisher: string;
  };
  includeSql: boolean;
  includeFunctions: boolean;
  includeReact: boolean;
  securityRisk: "low" | "medium" | "high" | "critical";
}

type InfraFixtureCatalog = Record<string, InfraFixtureCase>;

const fixtureFile = path.resolve(
  process.cwd(),
  "packages/fixtures/samples/generators/infra/infra-cases.json"
);

const loadFixtureCatalog = async (): Promise<InfraFixtureCatalog> =>
  JSON.parse(await readFile(fixtureFile, "utf-8")) as InfraFixtureCatalog;

const toInfraIr = (fixtureName: string, fixtureCase: InfraFixtureCase): PowerPlatformIR => {
  const base = createEmptyPowerPlatformIR({
    solutionFolder: `fixtures/infra/${fixtureName}`
  });
  const hasExplicitMetadata =
    fixtureCase.solution.name.trim().length > 0 &&
    fixtureCase.solution.uniqueName.trim().length > 0 &&
    fixtureCase.solution.publisher.trim().length > 0;

  return validatePowerPlatformIR({
    ...base,
    solution: hasExplicitMetadata
      ? {
          ...base.solution,
          name: fixtureCase.solution.name,
          uniqueName: fixtureCase.solution.uniqueName,
          publisher: {
            ...base.solution.publisher,
            uniqueName: fixtureCase.solution.publisher,
            displayName: fixtureCase.solution.publisher
          }
        }
      : base.solution,
    analysisSummary: {
      ...base.analysisSummary,
      entities: fixtureCase.includeSql ? 3 : 0,
      flows: fixtureCase.includeFunctions ? 2 : 0,
      canvasApps: fixtureCase.includeReact ? 1 : 0,
      warnings:
        fixtureCase.securityRisk === "high" || fixtureCase.securityRisk === "critical" ? 4 : 1
    }
  });
};

const getArtifactContent = (
  result: Awaited<ReturnType<typeof generateAzureInfraArtifacts>>,
  filePath: string
): string => {
  const artifact = result.artifacts.find((entry) => entry.filePath === filePath);
  if (!artifact) {
    throw new Error(`Missing generated artifact: ${filePath}`);
  }

  return artifact.content;
};

describe("generateAzureInfraArtifacts", () => {
  it("produces deterministic generated Bicep artifacts", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("mixedFullStackSolution", fixtures.mixedFullStackSolution);

    const first = await generateAzureInfraArtifacts(input);
    const second = await generateAzureInfraArtifacts(input);

    expect(first).toEqual(second);
  });

  it("generates main.bicep and all infra modules", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("mixedFullStackSolution", fixtures.mixedFullStackSolution);
    const result = await generateAzureInfraArtifacts(input);

    expect(result.artifacts.some((artifact) => artifact.filePath === "infra/main.bicep")).toBe(true);
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/modules/app-service.bicep")
    ).toBe(true);
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/modules/function-app.bicep")
    ).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.filePath === "infra/modules/storage.bicep")).toBe(
      true
    );
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/modules/sql-server.bicep")
    ).toBe(true);
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/modules/sql-database.bicep")
    ).toBe(true);
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/modules/key-vault.bicep")
    ).toBe(true);
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/modules/app-insights.bicep")
    ).toBe(true);
    expect(
      result.artifacts.some(
        (artifact) => artifact.filePath === "infra/modules/managed-identity.bicep"
      )
    ).toBe(true);
  });

  it("generates environment parameter files", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("minimalSolutionInfra", fixtures.minimalSolutionInfra);
    const result = await generateAzureInfraArtifacts(input);

    expect(result.artifacts.some((artifact) => artifact.filePath === "infra/parameters.dev.json")).toBe(
      true
    );
    expect(result.artifacts.some((artifact) => artifact.filePath === "infra/parameters.test.json")).toBe(
      true
    );
    expect(result.artifacts.some((artifact) => artifact.filePath === "infra/parameters.prod.json")).toBe(
      true
    );
  });

  it("does not embed secrets in generated outputs", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("highRiskSecurityHeavySolution", fixtures.highRiskSecurityHeavySolution);
    const result = await generateAzureInfraArtifacts(input);

    const contentBlob = result.artifacts.map((artifact) => artifact.content.toLowerCase()).join("\n");
    expect(contentBlob.includes("clientsecret")).toBe(false);
    expect(contentBlob.includes("sqladminpassword")).toBe(false);
    expect(contentBlob.includes("apikey")).toBe(false);
    expect(contentBlob.includes("connectionstring=")).toBe(false);
  });

  it("includes managed identity and Key Vault placeholder guidance", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("solutionWithFunctionsRequirement", fixtures.solutionWithFunctionsRequirement);
    const result = await generateAzureInfraArtifacts(input);

    expect(getArtifactContent(result, "infra/modules/managed-identity.bicep")).toContain(
      "TODO: assign RBAC roles"
    );
    expect(getArtifactContent(result, "infra/modules/key-vault.bicep")).toContain(
      "TODO: configure secret lifecycle"
    );
  });

  it("emits infra generation plan metadata", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("mixedFullStackSolution", fixtures.mixedFullStackSolution);
    const result = await generateAzureInfraArtifacts(input);

    expect(result.output.infraPlan.plannedResources.length).toBeGreaterThan(0);
    expect(result.output.infraPlan.plannedModules.length).toBe(8);
    expect(result.output.infraPlan.environmentParameterFiles).toEqual([
      "infra/parameters.dev.json",
      "infra/parameters.prod.json",
      "infra/parameters.test.json"
    ]);
    expect(result.output.infraPlan.securityManualReviewItems.length).toBeGreaterThan(0);
    expect(result.output.infraPlan.unresolvedConfigurationItems.length).toBeGreaterThan(0);
    expect(result.output.infraPlan.deploymentReadiness.scaffoldOnly).toBe(true);
    expect(result.output.infraPlan.deploymentReadiness.needsConfig).toBe(true);
    expect(result.output.infraPlan.deploymentReadiness.needsSecurityReview).toBe(true);
  });

  it("marks deployment readiness blocked for missing solution metadata", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("missingSolutionMetadata", fixtures.missingSolutionMetadata);
    const result = await generateAzureInfraArtifacts(input);

    expect(result.output.infraPlan.deploymentReadiness.blocked).toBe(true);
    expect(
      result.warnings.some((warning) => warning.code === "INFRA_MISSING_SOLUTION_METADATA")
    ).toBe(true);
  });

  it("matches generated infra main.bicep snapshot output", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("mixedFullStackSolution", fixtures.mixedFullStackSolution);
    const result = await generateAzureInfraArtifacts(input);

    expect(getArtifactContent(result, "infra/main.bicep")).toMatchSnapshot();
  });
});

describe("generateAzureInfraFromPowerPlatformIR", () => {
  it("generates infra artifacts from validated PowerPlatformIR input", async () => {
    const fixtures = await loadFixtureCatalog();
    const input = toInfraIr("solutionWithReactRequirement", fixtures.solutionWithReactRequirement);

    const result = await generateAzureInfraFromPowerPlatformIR(input);

    expect(result.artifacts.some((artifact) => artifact.filePath === "infra/main.bicep")).toBe(true);
    expect(
      result.artifacts.some((artifact) => artifact.filePath === "infra/generation-report.md")
    ).toBe(true);
  });
});
