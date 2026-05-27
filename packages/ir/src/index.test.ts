import { describe, expect, it } from "vitest";

import {
  createEmptyPowerPlatformIR,
  mergeAnalysisSummaryIntoIR,
  mergeDependencyEdgesIntoIR,
  createUnsupportedFeature,
  createWarning,
  mergeParseResultIntoIR,
  serializeDeterministicIR,
  validatePowerPlatformIR
} from "./index";

describe("PowerPlatformIR", () => {
  it("creates a valid empty IR", () => {
    const ir = createEmptyPowerPlatformIR({
      solutionFolder: "/tmp/solution"
    });

    expect(() => validatePowerPlatformIR(ir)).not.toThrow();
    expect(ir.solution.sourceFolder).toBe("/tmp/solution");
    expect(ir.solution.uniqueName).toBe("unknown_solution");
    expect(ir.confidence).toBe(1);
    expect(ir.dependencyGraph.edges).toEqual([]);
    expect(ir.analysisSummary.filesScanned).toBe(0);
  });

  it("rejects invalid IR payloads", () => {
    const invalid = {
      ...createEmptyPowerPlatformIR(),
      confidence: 2
    };

    expect(() => validatePowerPlatformIR(invalid)).toThrow();
  });

  it("serializes deterministically", () => {
    const ir = createEmptyPowerPlatformIR();
    const serializationA = serializeDeterministicIR(ir);
    const serializationB = serializeDeterministicIR({
      ...ir,
      solution: {
        ...ir.solution
      }
    });

    expect(serializationA).toBe(serializationB);
  });

  it("creates parser warnings with validated shape", () => {
    const warning = createWarning({
      code: "UNKNOWN_FIELD",
      message: "Unrecognized field encountered",
      sourceLocation: "solution/manifest.json",
      provenance: {
        sourcePath: "solution/manifest.json",
        sourceType: "solution"
      }
    });

    expect(warning.code).toBe("UNKNOWN_FIELD");
    expect(warning.severity).toBe("warning");
    expect(warning.confidence).toBe(0.5);
  });

  it("creates unsupported feature entries with required fields", () => {
    const unsupported = createUnsupportedFeature({
      featureType: "canvas.experimental-control",
      sourceLocation: "CanvasApp/Screens/Home.fx.yaml",
      reason: "Experimental control is not supported in MVP",
      suggestedRemediation: "Replace with a standard control before migration",
      severity: "high",
      confidence: 0.2,
      provenance: {
        sourcePath: "CanvasApp/Screens/Home.fx.yaml",
        sourceType: "canvas"
      }
    });

    expect(unsupported.featureType).toBe("canvas.experimental-control");
    expect(unsupported.severity).toBe("high");
  });

  it("preserves provenance when merging parse results", () => {
    const baseIr = createEmptyPowerPlatformIR();
    const warning = createWarning({
      code: "MISSING_OPTION_SET",
      message: "Option set reference missing",
      sourceLocation: "dataverse/entities/account.xml",
      provenance: {
        sourcePath: "dataverse/entities/account.xml",
        sourceType: "dataverse"
      }
    });

    const merged = mergeParseResultIntoIR(baseIr, "environmentVariables", {
      data: [
        {
          artifactId: "env:api_url",
          schemaName: "api_url",
          type: "String",
          defaultValue: "https://example.test",
          provenance: {
            sourcePath: "environmentvariables.json",
            sourceType: "environment-variable"
          },
          confidence: 0.9
        }
      ],
      warnings: [warning],
      unsupported: [],
      confidence: 0.9,
      provenance: {
        sourcePath: "environmentvariables.json",
        sourceType: "environment-variable"
      }
    });

    expect(merged.environmentVariables[0]?.provenance.sourcePath).toBe(
      "environmentvariables.json"
    );
    expect(merged.warnings[0]?.provenance.sourceType).toBe("dataverse");
  });

  it("merges dependency edges with unresolved details", () => {
    const baseIr = createEmptyPowerPlatformIR();
    const merged = mergeDependencyEdgesIntoIR(baseIr, [
      {
        sourceArtifactId: "solution:default",
        targetArtifactId: "entity:account",
        dependencyType: "solution-entity",
        provenance: {
          sourcePath: "solution.xml",
          sourceType: "solution"
        },
        confidence: 0.95,
        resolved: true
      },
      {
        sourceArtifactId: "relationship:account-contact",
        targetArtifactId: "entity:contact",
        dependencyType: "relationship-target-entity",
        provenance: {
          sourcePath: "entities/account.xml",
          sourceType: "dataverse"
        },
        confidence: 0.7,
        resolved: false,
        unresolvedWarning: "Target entity could not be resolved."
      }
    ]);

    expect(merged.dependencyGraph.edges).toHaveLength(2);
    expect(merged.dependencyGraph.edges[1]?.resolved).toBe(false);
    expect(merged.dependencyGraph.edges[1]?.unresolvedWarning).toContain("resolved");
  });

  it("merges analysis summary", () => {
    const baseIr = createEmptyPowerPlatformIR();
    const merged = mergeAnalysisSummaryIntoIR(baseIr, {
      filesScanned: 10,
      classifiedFiles: 9,
      unknownFiles: 1,
      solutionMetadataPresence: true,
      entities: 2,
      attributes: 4,
      relationships: 1,
      choices: 1,
      canvasApps: 1,
      canvasScreens: 2,
      canvasControls: 4,
      canvasFormulas: 3,
      canvasScreensByReadiness: {
        high: 1,
        medium: 1,
        low: 0,
        blocked: 0
      },
      canvasControlsByRole: {
        button: 2,
        text: 2
      },
      canvasBlockedControls: 0,
      canvasUnknownControls: 0,
      canvasComplexFormulas: 1,
      canvasLayoutWarnings: 1,
      environmentVariables: 2,
      connectionReferences: 1,
      securityRoles: 1,
      warnings: 3,
      unsupportedFeatures: 1,
      unresolvedDependencies: 2
    });

    expect(merged.analysisSummary.filesScanned).toBe(10);
    expect(merged.analysisSummary.canvasScreens).toBe(2);
    expect(merged.analysisSummary.unresolvedDependencies).toBe(2);
  });
});
