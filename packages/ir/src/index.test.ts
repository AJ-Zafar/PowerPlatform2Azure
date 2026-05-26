import { describe, expect, it } from "vitest";

import {
  createEmptyPowerPlatformIR,
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
    expect(ir.confidence).toBe(1);
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
          key: "api_url",
          value: "https://example.test",
          provenance: {
            sourcePath: "environmentvariables.json",
            sourceType: "environment-variable"
          }
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
});
