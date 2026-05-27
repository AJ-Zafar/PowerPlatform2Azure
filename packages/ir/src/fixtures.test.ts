import { describe, expect, it } from "vitest";

import { loadFixtureText } from "@power-exit/fixtures";

import { serializeDeterministicIR, validatePowerPlatformIR } from "./index";

describe("PowerPlatformIR fixtures", () => {
  it("accepts valid empty IR fixture", async () => {
    const fixture = await loadFixtureText("ir/valid-empty-ir.json");
    const payload = JSON.parse(fixture) as unknown;

    expect(() => validatePowerPlatformIR(payload)).not.toThrow();
  });

  it("rejects invalid IR fixture", async () => {
    const fixture = await loadFixtureText("ir/invalid-ir.json");
    const payload = JSON.parse(fixture) as unknown;

    expect(() => validatePowerPlatformIR(payload)).toThrow();
  });

  it("serializes fixture deterministically", async () => {
    const fixture = await loadFixtureText("ir/valid-empty-ir.json");
    const payload = JSON.parse(fixture) as unknown;

    expect(serializeDeterministicIR(payload)).toMatchInlineSnapshot(
      `"{"analysisSummary":{"attributes":0,"canvasApps":0,"canvasBlockedControls":0,"canvasComplexFormulas":0,"canvasControls":0,"canvasControlsByRole":{},"canvasFormulas":0,"canvasLayoutWarnings":0,"canvasScreens":0,"canvasScreensByReadiness":{"blocked":0,"high":0,"low":0,"medium":0},"canvasUnknownControls":0,"choices":0,"classifiedFiles":0,"connectionReferences":0,"entities":0,"environmentVariables":0,"filesScanned":0,"relationships":0,"securityRoles":0,"solutionMetadataPresence":false,"unknownFiles":0,"unresolvedDependencies":0,"unsupportedFeatures":0,"warnings":0},"canvasApps":[],"cloudFlows":[],"confidence":1,"connectionReferences":[],"dataverse":{"entities":[],"optionSets":[],"relationships":[]},"dependencyGraph":{"edges":[]},"environmentVariables":[],"provenance":{"sourcePath":"unknown-solution","sourceType":"solution"},"security":{"roles":[]},"solution":{"artifactId":"solution:default","confidence":1,"localizedNames":[],"managed":false,"name":"Unknown Solution","provenance":{"sourcePath":"unknown-solution","sourceType":"solution"},"publisher":{"displayName":"Unknown Publisher","uniqueName":"unknown_publisher"},"sourceFolder":"unknown-solution","uniqueName":"unknown_solution","version":"0.0.0"},"unsupportedFeatures":[],"warnings":[]}"`
    );
  });
});
