import path from "node:path";

import { describe, expect, it } from "vitest";

import { createUnsupportedFeature, stableStringify, type PowerPlatformIR } from "@power-exit/ir";
import { analyseSolutionFolder } from "@power-exit/parsers";

import { assessPowerPlatformIR } from "./index";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

const withExtraUnsupported = (ir: PowerPlatformIR, count: number): PowerPlatformIR => ({
  ...ir,
  unsupportedFeatures: [
    ...ir.unsupportedFeatures,
    ...Array.from({ length: count }, (_, index) =>
      createUnsupportedFeature({
        featureType: `assessment.synthetic.unsupported-${index}`,
        sourceLocation: `synthetic/${index}`,
        reason: "Synthetic unsupported feature for deterministic scoring tests.",
        suggestedRemediation: "Fix synthetic unsupported source.",
        severity: "high",
        confidence: 0.9,
        provenance: {
          sourcePath: `synthetic/${index}`,
          sourceType: "unknown"
        }
      })
    )
  ]
});

describe("assessPowerPlatformIR", () => {
  it("produces deterministic assessment output", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("flow-heavy"))).ir;

    const assessmentA = assessPowerPlatformIR(ir);
    const assessmentB = assessPowerPlatformIR(ir);

    expect(stableStringify(assessmentA)).toBe(stableStringify(assessmentB));
  });

  it("increases risk and complexity when unsupported features increase", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("mixed-partial"))).ir;
    const elevatedIr = withExtraUnsupported(baseIr, 8);

    const baseAssessment = assessPowerPlatformIR(baseIr);
    const elevatedAssessment = assessPowerPlatformIR(elevatedIr);

    expect(elevatedAssessment.overallRiskScore).toBeGreaterThan(baseAssessment.overallRiskScore);
    expect(elevatedAssessment.overallComplexityScore).toBeGreaterThan(
      baseAssessment.overallComplexityScore
    );
  });

  it("creates blockers for critical unsupported items", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("mixed-partial"))).ir;
    const irWithCriticalUnsupported: PowerPlatformIR = {
      ...baseIr,
      unsupportedFeatures: [
        ...baseIr.unsupportedFeatures,
        createUnsupportedFeature({
          featureType: "critical.manual.intervention",
          sourceLocation: "workflows/critical.json",
          reason: "Critical unsupported automation branch.",
          suggestedRemediation: "Manual architecture redesign required.",
          severity: "critical",
          confidence: 1,
          provenance: {
            sourcePath: "workflows/critical.json",
            sourceType: "flow"
          }
        })
      ]
    };

    const assessment = assessPowerPlatformIR(irWithCriticalUnsupported);

    expect(assessment.blockers.some((blocker) => blocker.severity === "critical")).toBe(true);
    expect(assessment.overallReadiness).toBe("blocked");
  });

  it("degrades readiness when canvas readiness is low", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("canvas-heavy"))).ir;
    const degradedIr: PowerPlatformIR = {
      ...baseIr,
      canvasApps: baseIr.canvasApps.map((app) => ({
        ...app,
        migrationReadiness: "low",
        screens: app.screens.map((screen) => ({
          ...screen,
          migrationReadiness: "low",
          controls: screen.controls.map((control) => ({
            ...control,
            migrationReadiness: "low"
          }))
        }))
      })),
      analysisSummary: {
        ...baseIr.analysisSummary,
        canvasBlockedControls: 0,
        canvasScreensByReadiness: {
          high: 0,
          medium: 0,
          low: Math.max(1, baseIr.analysisSummary.canvasScreens),
          blocked: 0
        }
      }
    };

    const baseAssessment = assessPowerPlatformIR(baseIr);
    const degradedAssessment = assessPowerPlatformIR(degradedIr);

    expect(degradedAssessment.overallReadiness).not.toBe("high");
    expect(degradedAssessment.domainAssessments.canvas.readiness).toBe("low");
    expect(degradedAssessment.overallComplexityScore).not.toBe(baseAssessment.overallComplexityScore);
  });

  it("degrades readiness when any flow is blocked", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("flow-heavy"))).ir;
    const flowBlockedIr: PowerPlatformIR = {
      ...baseIr,
      cloudFlows: baseIr.cloudFlows.map((flow, index) =>
        index === 0 ? { ...flow, migrationReadiness: "blocked" } : flow
      )
    };

    const assessment = assessPowerPlatformIR(flowBlockedIr);

    expect(assessment.domainAssessments.cloudFlows.readiness).toBe("blocked");
    expect(["low", "blocked"]).toContain(assessment.overallReadiness);
  });

  it("increases risk when unresolved dependencies increase", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("mixed-partial"))).ir;
    const unresolvedIr: PowerPlatformIR = {
      ...baseIr,
      dependencyGraph: {
        edges: [
          ...baseIr.dependencyGraph.edges,
          {
            sourceArtifactId: "flow:synthetic",
            targetArtifactId: "entity:unresolved",
            dependencyType: "action-dataverse-entity",
            provenance: {
              sourcePath: "synthetic",
              sourceType: "flow"
            },
            confidence: 0.7,
            resolved: false,
            unresolvedWarning: "Synthetic unresolved dependency."
          }
        ]
      }
    };

    const baseAssessment = assessPowerPlatformIR(baseIr);
    const unresolvedAssessment = assessPowerPlatformIR(unresolvedIr);

    expect(unresolvedAssessment.overallRiskScore).toBeGreaterThan(baseAssessment.overallRiskScore);
    expect(unresolvedAssessment.domainAssessments.dependencies.score).toBeLessThan(
      baseAssessment.domainAssessments.dependencies.score
    );
  });
});
