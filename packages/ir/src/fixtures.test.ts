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
      `"{"canvasApps":[],"cloudFlows":[],"confidence":1,"connectionReferences":[],"dataverse":{"entities":[],"optionSets":[],"relationships":[]},"environmentVariables":[],"provenance":{"sourcePath":"unknown-solution","sourceType":"solution"},"security":{"roles":[]},"solution":{"artifactId":"solution:default","name":"Unknown Solution","provenance":{"sourcePath":"unknown-solution","sourceType":"solution"},"sourceFolder":"unknown-solution","version":"0.0.0"},"unsupportedFeatures":[],"warnings":[]}"`
    );
  });
});
