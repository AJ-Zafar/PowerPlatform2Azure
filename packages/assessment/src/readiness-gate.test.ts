import path from "node:path";

import { describe, expect, it } from "vitest";

import { createUnsupportedFeature, stableStringify } from "@power-exit/ir";
import { analyseSolutionFolder } from "@power-exit/parsers";

import { assessPowerPlatformIR } from "./engine";
import {
  evaluateReadinessGate,
  renderReadinessGateMarkdown,
  serializeReadinessGate
} from "./readiness-gate";

const solutionFixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

describe("evaluateReadinessGate", () => {
  it("produces deterministic readiness gate output", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const assessment = assessPowerPlatformIR(ir);

    const gateA = evaluateReadinessGate({ ir, assessment });
    const gateB = evaluateReadinessGate({ ir, assessment });

    expect(stableStringify(gateA)).toBe(stableStringify(gateB));
    expect(serializeReadinessGate(gateA)).toBe(serializeReadinessGate(gateB));
  });

  it("fails when critical unsupported features are present and disallowed", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const assessment = assessPowerPlatformIR({
      ...baseIr,
      unsupportedFeatures: [
        ...baseIr.unsupportedFeatures,
        createUnsupportedFeature({
          featureType: "critical.synthetic.feature",
          sourceLocation: "synthetic/source",
          reason: "Critical unsupported synthetic feature.",
          suggestedRemediation: "Manual redesign required.",
          severity: "critical",
          confidence: 0.9,
          provenance: {
            sourcePath: "synthetic/source",
            sourceType: "unknown"
          }
        })
      ]
    });
    const gate = evaluateReadinessGate({
      ir: {
        ...baseIr,
        unsupportedFeatures: [
          ...baseIr.unsupportedFeatures,
          createUnsupportedFeature({
            featureType: "critical.synthetic.feature",
            sourceLocation: "synthetic/source",
            reason: "Critical unsupported synthetic feature.",
            suggestedRemediation: "Manual redesign required.",
            severity: "critical",
            confidence: 0.9,
            provenance: {
              sourcePath: "synthetic/source",
              sourceType: "unknown"
            }
          })
        ]
      },
      assessment
    });

    expect(gate.status).toBe("fail");
    expect(gate.statusReasons.some((reason) => reason.includes("critical unsupported"))).toBe(true);
  });

  it("warns when confidence is below configured threshold", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const assessment = assessPowerPlatformIR(ir);
    const gate = evaluateReadinessGate({
      ir,
      assessment,
      thresholds: {
        requireNoBlockers: false,
        minConfidence: Math.min(1, assessment.overallConfidence + 0.05)
      }
    });

    expect(gate.status).toBe("warn");
    expect(gate.statusReasons.some((reason) => reason.startsWith("Confidence"))).toBe(true);
  });

  it("fails when unresolved dependencies breach threshold by a large margin", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const assessment = assessPowerPlatformIR(ir);
    const gate = evaluateReadinessGate({
      ir,
      assessment,
      thresholds: {
        requireNoBlockers: false,
        maxUnresolvedDependencies: 0
      },
      unresolvedDependencies: [
        {
          id: "dep-1",
          referenceType: "flow-action",
          referenceName: "GetRecord",
          message: "Missing flow action dependency.",
          severity: "high"
        },
        {
          id: "dep-2",
          referenceType: "connection-reference",
          referenceName: "shared_dataverse",
          message: "Missing connection reference.",
          severity: "high"
        },
        {
          id: "dep-3",
          referenceType: "adapter",
          referenceName: "customConnectorAdapter",
          message: "Adapter contract unresolved.",
          severity: "high"
        },
        {
          id: "dep-4",
          referenceType: "environment-variable",
          referenceName: "DataverseEndpoint",
          message: "Environment variable missing.",
          severity: "medium"
        },
        {
          id: "dep-5",
          referenceType: "flow-trigger",
          referenceName: "When_record_changes",
          message: "Trigger binding unresolved.",
          severity: "high"
        }
      ]
    });

    expect(gate.status).toBe("fail");
    expect(
      gate.statusReasons.some((reason) => reason.includes("Unresolved dependencies"))
    ).toBe(true);
  });

  it("tracks original vs effective status when valid waiver applies", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const ir = {
      ...baseIr,
      unsupportedFeatures: [
        ...baseIr.unsupportedFeatures,
        createUnsupportedFeature({
          featureType: "critical.synthetic.feature",
          sourceLocation: "synthetic/source",
          reason: "Critical unsupported synthetic feature.",
          suggestedRemediation: "Manual redesign required.",
          severity: "critical",
          confidence: 0.9,
          provenance: {
            sourcePath: "synthetic/source",
            sourceType: "unknown"
          }
        })
      ]
    };
    const assessment = assessPowerPlatformIR(ir);

    const gate = evaluateReadinessGate({
      ir,
      assessment,
      policy: {
        profileName: "prod",
        description: "prod",
        thresholds: {
          maxRiskScore: 100,
          maxComplexityScore: 100,
          minConfidence: 0,
          allowCriticalUnsupported: false,
          maxUnresolvedDependencies: 99,
          maxHighSeverityFindings: 99,
          requireNoBlockers: false
        },
        severityOverrides: {},
        categoryOverrides: {},
        requiredEvidence: [],
        metadata: {},
        allowedWaivers: [
          {
            waiverId: "WVR-001",
            appliesTo: {
              unsupportedFeatureId: "critical.synthetic.feature:synthetic/source"
            },
            reason: "Approved",
            owner: "owner",
            expiresOn: "2099-12-31",
            approvedBy: "approver",
            evidenceLink: "https://example.test/WVR-001",
            riskAccepted: true,
            createdOn: "2026-05-28"
          }
        ]
      }
    });

    expect(gate.originalStatus).toBe("fail");
    expect(gate.effectiveStatus).toBe("warn");
    expect(gate.waiverAudit.waivedCount).toBe(1);
    expect(gate.statusReasons.some((reason) => reason.includes("Applied 1 waiver"))).toBe(true);
  });

  it("ignores expired waivers and marks critical waivers without risk acceptance invalid", async () => {
    const baseIr = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const ir = {
      ...baseIr,
      unsupportedFeatures: [
        ...baseIr.unsupportedFeatures,
        createUnsupportedFeature({
          featureType: "critical.synthetic.feature",
          sourceLocation: "synthetic/source",
          reason: "Critical unsupported synthetic feature.",
          suggestedRemediation: "Manual redesign required.",
          severity: "critical",
          confidence: 0.9,
          provenance: {
            sourcePath: "synthetic/source",
            sourceType: "unknown"
          }
        })
      ]
    };
    const assessment = assessPowerPlatformIR(ir);

    const gate = evaluateReadinessGate({
      ir,
      assessment,
      policy: {
        profileName: "prod",
        description: "prod",
        thresholds: {
          maxRiskScore: 100,
          maxComplexityScore: 100,
          minConfidence: 0,
          allowCriticalUnsupported: false,
          maxUnresolvedDependencies: 99,
          maxHighSeverityFindings: 99,
          requireNoBlockers: false
        },
        severityOverrides: {},
        categoryOverrides: {},
        requiredEvidence: [],
        metadata: {},
        allowedWaivers: [
          {
            waiverId: "WVR-EXPIRED",
            appliesTo: {
              unsupportedFeatureId: "critical.synthetic.feature:synthetic/source"
            },
            reason: "Expired",
            owner: "owner",
            expiresOn: "2020-01-01",
            approvedBy: "approver",
            evidenceLink: "https://example.test/WVR-EXPIRED",
            riskAccepted: true,
            createdOn: "2020-01-01"
          },
          {
            waiverId: "WVR-NO-RISK",
            appliesTo: {
              unsupportedFeatureId: "critical.synthetic.feature:synthetic/source"
            },
            reason: "No risk acceptance",
            owner: "owner",
            expiresOn: "2099-12-31",
            approvedBy: "approver",
            evidenceLink: "https://example.test/WVR-NO-RISK",
            riskAccepted: false,
            createdOn: "2026-05-28"
          }
        ]
      }
    });

    expect(gate.status).toBe("fail");
    expect(gate.waiverAudit.waivedCount).toBe(0);
    expect(gate.waiverAudit.expiredCount).toBe(1);
    expect(gate.waiverAudit.invalidCount).toBe(1);
  });

  it("renders deterministic markdown with required sections", async () => {
    const ir = (await analyseSolutionFolder(solutionFixturePath("minimal-valid"))).ir;
    const assessment = assessPowerPlatformIR(ir);
    const gate = evaluateReadinessGate({
      ir,
      assessment,
      thresholds: {
        requireNoBlockers: false,
        allowCriticalUnsupported: true,
        maxRiskScore: 100,
        maxComplexityScore: 100,
        minConfidence: 0,
        maxUnresolvedDependencies: 99,
        maxHighSeverityFindings: 99
      }
    });
    const markdown = renderReadinessGateMarkdown(gate);

    expect(gate.status).toBe("pass");
    expect(markdown).toContain("## Gate status");
    expect(markdown).toContain("## Threshold summary");
    expect(markdown).toContain("## Pass/fail reasons");
    expect(markdown).toContain("## Original unwaived reasons");
    expect(markdown).toContain("## Waiver audit");
    expect(markdown).toContain("## Blockers");
    expect(markdown).toContain("## Unresolved dependencies");
    expect(markdown).toContain("## High severity findings");
    expect(markdown).toContain("## Unsupported features");
    expect(markdown).toContain("## Manual review items");
    expect(markdown).toContain("## Recommended next action");
  });
});

