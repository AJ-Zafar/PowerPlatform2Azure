import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createUnsupportedFeature } from "@power-exit/ir";

import { runCli } from "./index";

const createTempDirectory = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "power-exit-gate-cli-"));

interface GatePayload {
  status: "pass" | "warn" | "fail";
  originalStatus: "pass" | "warn" | "fail";
  effectiveStatus: "pass" | "warn" | "fail";
  thresholds: {
    maxRiskScore: number;
    maxComplexityScore: number;
    minConfidence: number;
    allowCriticalUnsupported: boolean;
    maxUnresolvedDependencies: number;
    maxHighSeverityFindings: number;
    requireNoBlockers: boolean;
  };
  waiverAudit: {
    waivedCount: number;
    expiredCount: number;
    invalidCount: number;
  };
  policy: {
    profileName: "dev" | "test" | "prod" | "strict";
    sourcePolicyFile?: string;
  } | null;
  statusReasons: string[];
  originalStatusReasons: string[];
}

interface GateCommandPayload {
  command: "gate";
  gateStatus: "pass" | "warn" | "fail";
  ci: boolean;
  strict: boolean;
  ciExitCode: number;
  generationPlanAvailable: boolean;
  policyUsed: string | null;
  profileUsed: string | null;
  statusReasons: string[];
}

const fixturePath = (fixtureName: string): string =>
  path.resolve(process.cwd(), "packages/fixtures/samples/solutions", fixtureName);

const parseGateCommandPayload = (output: string): GateCommandPayload =>
  JSON.parse(output) as GateCommandPayload;

const parseReadinessGate = async (outputFolder: string): Promise<GatePayload> =>
  JSON.parse(await readFile(path.join(outputFolder, "readiness-gate.json"), "utf-8")) as GatePayload;

const writeMinimalGenerationPlan = async (outputFolder: string): Promise<void> => {
  const generationPlan = {
    plannedFiles: [],
    plannedDirectories: [],
    skippedFiles: [],
    overwrittenFiles: [],
    warnings: [],
    unsupportedFeatures: [],
    formulaHotspots: [],
    manualReviewItems: [],
    summary: {
      totalPlannedFiles: 0,
      totalPlannedDirectories: 0,
      creates: 0,
      overwrites: 0,
      skips: 0,
      unchanged: 0,
      warnings: 0,
      unsupportedFeatures: 0,
      formulaHotspots: 0,
      manualReviewItems: 0
    },
    sqlPlan: null,
    functionsPlan: null,
    infraPlan: null
  };
  await writeFile(
    path.join(outputFolder, "generation-plan.json"),
    `${JSON.stringify(generationPlan, null, 2)}\n`,
    "utf-8"
  );
};

const makePolicyProfile = (
  profileName: "dev" | "test" | "prod" | "strict",
  thresholds: GatePayload["thresholds"],
  extra?: {
    allowedWaivers?: unknown[];
    requiredEvidence?: string[];
  }
): Record<string, unknown> => ({
  profileName,
  description: `${profileName} profile`,
  thresholds,
  severityOverrides: {},
  categoryOverrides: {},
  allowedWaivers: extra?.allowedWaivers ?? [],
  requiredEvidence: extra?.requiredEvidence ?? [],
  metadata: {
    owner: "test"
  }
});

const writePolicyFile = async (input: {
  rootFolder: string;
  profiles: Record<string, unknown>[];
}): Promise<string> => {
  const policyPath = path.join(input.rootFolder, "power-exit.policy.json");
  await writeFile(
    policyPath,
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        description: "Test policy file",
        profiles: input.profiles
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
  return policyPath;
};

const appendCriticalUnsupportedFeature = async (outputFolder: string): Promise<void> => {
  const irPath = path.join(outputFolder, "ir.json");
  const ir = JSON.parse(await readFile(irPath, "utf-8")) as {
    unsupportedFeatures: unknown[];
  };
  ir.unsupportedFeatures = [
    ...ir.unsupportedFeatures,
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
  ];
  await writeFile(irPath, `${JSON.stringify(ir, null, 2)}\n`, "utf-8");
};

describe("power-exit gate command", () => {
  it("produces pass status when thresholds pass and generation plan is available", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-pass");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);

    const exitCode = await runCli(
      [
        "gate",
        outputFolder,
        "--max-risk",
        "100",
        "--max-complexity",
        "100",
        "--min-confidence",
        "0"
      ],
      stdOut.push.bind(stdOut),
      stdErr.push.bind(stdErr)
    );

    expect(exitCode).toBe(0);
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("pass");
    expect(await readFile(path.join(outputFolder, "readiness-gate.md"), "utf-8")).toContain(
      "## Threshold summary"
    );
    expect(parseGateCommandPayload(stdOut[0]).generationPlanAvailable).toBe(true);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("falls back when generation-plan is missing and emits warn status", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-warn");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    expect(await runCli(["gate", outputFolder], stdOut.push.bind(stdOut), stdErr.push.bind(stdErr))).toBe(
      0
    );
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("warn");
    expect(gate.statusReasons.some((reason) => reason.includes("high/critical items"))).toBe(true);
    expect(parseGateCommandPayload(stdOut[0]).generationPlanAvailable).toBe(false);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("fails when critical unsupported features are present", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-fail");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const irPath = path.join(outputFolder, "ir.json");
    const ir = JSON.parse(await readFile(irPath, "utf-8")) as {
      unsupportedFeatures: unknown[];
    };
    ir.unsupportedFeatures = [
      ...ir.unsupportedFeatures,
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
    ];
    await writeFile(irPath, `${JSON.stringify(ir, null, 2)}\n`, "utf-8");

    expect(await runCli(["gate", outputFolder], stdOut.push.bind(stdOut), stdErr.push.bind(stdErr))).toBe(
      0
    );
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("fail");
    expect(gate.statusReasons.some((reason) => reason.includes("critical unsupported"))).toBe(true);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("supports threshold overrides and unresolved dependency threshold failure", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-overrides");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", outputFolder],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    const generationPlanPath = path.join(outputFolder, "generation-plan.json");
    const generationPlan = JSON.parse(await readFile(generationPlanPath, "utf-8")) as {
      functionsPlan: {
        unresolvedDependencies: Array<{
          referenceType: string;
          referenceName: string;
          sourceArtifactId: string;
        }>;
      } | null;
    };
    if (generationPlan.functionsPlan) {
      generationPlan.functionsPlan.unresolvedDependencies = [
        {
          referenceType: "flow-action",
          referenceName: "dependency-1",
          sourceArtifactId: "flow:1"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-2",
          sourceArtifactId: "flow:2"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-3",
          sourceArtifactId: "flow:3"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-4",
          sourceArtifactId: "flow:4"
        },
        {
          referenceType: "flow-action",
          referenceName: "dependency-5",
          sourceArtifactId: "flow:5"
        }
      ];
    }
    await writeFile(generationPlanPath, `${JSON.stringify(generationPlan, null, 2)}\n`, "utf-8");

    expect(
      await runCli(
        [
          "gate",
          outputFolder,
          "--max-risk",
          "95",
          "--max-complexity",
          "95",
          "--min-confidence",
          "0.1",
          "--max-unresolved",
          "0"
        ],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);

    const gate = await parseReadinessGate(outputFolder);
    expect(gate.thresholds.maxRiskScore).toBe(95);
    expect(gate.thresholds.maxComplexityScore).toBe(95);
    expect(gate.thresholds.minConfidence).toBe(0.1);
    expect(gate.thresholds.maxUnresolvedDependencies).toBe(0);
    expect(gate.status).toBe("fail");
    expect(gate.statusReasons.some((reason) => reason.includes("Unresolved dependencies"))).toBe(true);
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("implements CI exit behavior for pass/warn/fail and strict mode", async () => {
    const tempRoot = await createTempDirectory();
    const passFolder = path.join(tempRoot, "gate-pass-ci");
    const warnFolder = path.join(tempRoot, "gate-warn-ci");
    const failFolder = path.join(tempRoot, "gate-fail-ci");
    const passStdOut: string[] = [];
    const warnStdOut: string[] = [];
    const warnStrictStdOut: string[] = [];
    const failStdOut: string[] = [];

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", passFolder], () => undefined, () => undefined)).toBe(0);
    await writeMinimalGenerationPlan(passFolder);
    expect(
      await runCli(
        ["gate", passFolder, "--ci", "--max-risk", "100", "--max-complexity", "100", "--min-confidence", "0"],
        passStdOut.push.bind(passStdOut),
        () => undefined
      )
    ).toBe(0);
    expect(parseGateCommandPayload(passStdOut[0]).gateStatus).toBe("pass");

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", warnFolder], () => undefined, () => undefined)).toBe(0);
    expect(await runCli(["gate", warnFolder, "--ci"], warnStdOut.push.bind(warnStdOut), () => undefined)).toBe(0);
    expect(parseGateCommandPayload(warnStdOut[0]).gateStatus).toBe("warn");
    expect(
      await runCli(
        ["gate", warnFolder, "--ci", "--strict"],
        warnStrictStdOut.push.bind(warnStrictStdOut),
        () => undefined
      )
    ).toBe(1);
    expect(parseGateCommandPayload(warnStrictStdOut[0]).ciExitCode).toBe(1);

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", failFolder], () => undefined, () => undefined)).toBe(0);
    await writeMinimalGenerationPlan(failFolder);
    const failIrPath = path.join(failFolder, "ir.json");
    const failIr = JSON.parse(await readFile(failIrPath, "utf-8")) as {
      unsupportedFeatures: unknown[];
    };
    failIr.unsupportedFeatures = [
      ...failIr.unsupportedFeatures,
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
    ];
    await writeFile(failIrPath, `${JSON.stringify(failIr, null, 2)}\n`, "utf-8");

    expect(await runCli(["gate", failFolder, "--ci"], failStdOut.push.bind(failStdOut), () => undefined)).toBe(1);
    expect(parseGateCommandPayload(failStdOut[0]).gateStatus).toBe("fail");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("is deterministic across repeated runs and supports migrate --gate", async () => {
    const tempRoot = await createTempDirectory();
    const outputA = path.join(tempRoot, "run-a");
    const outputB = path.join(tempRoot, "run-b");
    const stdOut: string[] = [];
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", outputA, "--gate"],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    expect(await runCli(["gate", outputA], () => undefined, stdErr.push.bind(stdErr))).toBe(0);
    const gateJsonA = await readFile(path.join(outputA, "readiness-gate.json"), "utf-8");
    const gateMarkdownA = await readFile(path.join(outputA, "readiness-gate.md"), "utf-8");

    expect(
      await runCli(
        ["migrate", fixturePath("migrate-e2e"), "--out", outputB, "--gate"],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(0);
    expect(await runCli(["gate", outputB], () => undefined, stdErr.push.bind(stdErr))).toBe(0);
    const gateJsonB = await readFile(path.join(outputB, "readiness-gate.json"), "utf-8");
    const gateMarkdownB = await readFile(path.join(outputB, "readiness-gate.md"), "utf-8");

    expect(gateJsonA).toBe(gateJsonB);
    expect(gateMarkdownA).toBe(gateMarkdownB);
    expect(await readFile(path.join(outputA, "readiness-gate.json"), "utf-8")).toContain(
      "\"status\""
    );
    expect(await readFile(path.join(outputA, "readiness-gate.md"), "utf-8")).toContain(
      "## Recommended next action"
    );
    expect(JSON.parse(stdOut[0]) as { gate: boolean }).toEqual(
      expect.objectContaining({ gate: true })
    );
    expect(stdErr).toEqual([]);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("accepts --allow-critical-unsupported override", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-allow-critical");

    expect(await runCli(["analyse", fixturePath("minimal-valid"), "--out", outputFolder], () => undefined, () => undefined)).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const irPath = path.join(outputFolder, "ir.json");
    const ir = JSON.parse(await readFile(irPath, "utf-8")) as {
      unsupportedFeatures: unknown[];
    };
    ir.unsupportedFeatures = [
      ...ir.unsupportedFeatures,
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
    ];
    await writeFile(irPath, `${JSON.stringify(ir, null, 2)}\n`, "utf-8");

    expect(
      await runCli(
        [
          "gate",
          outputFolder,
          "--allow-critical-unsupported",
          "--max-risk",
          "100",
          "--max-complexity",
          "100",
          "--min-confidence",
          "0"
        ],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.thresholds.allowCriticalUnsupported).toBe(true);
    expect(gate.status).toBe("pass");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("loads policy profile thresholds and applies CLI threshold overrides", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-policy-overrides");
    const stdOut: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const policyPath = await writePolicyFile({
      rootFolder: tempRoot,
      profiles: [
        makePolicyProfile("dev", {
          maxRiskScore: 81,
          maxComplexityScore: 82,
          minConfidence: 0.51,
          allowCriticalUnsupported: false,
          maxUnresolvedDependencies: 9,
          maxHighSeverityFindings: 9,
          requireNoBlockers: true
        }),
        makePolicyProfile("strict", {
          maxRiskScore: 61,
          maxComplexityScore: 62,
          minConfidence: 0.75,
          allowCriticalUnsupported: false,
          maxUnresolvedDependencies: 1,
          maxHighSeverityFindings: 2,
          requireNoBlockers: true
        })
      ]
    });

    expect(
      await runCli(
        [
          "gate",
          outputFolder,
          "--policy",
          policyPath,
          "--profile",
          "strict",
          "--max-risk",
          "99",
          "--max-complexity",
          "98"
        ],
        stdOut.push.bind(stdOut),
        () => undefined
      )
    ).toBe(0);

    const gate = await parseReadinessGate(outputFolder);
    const commandPayload = parseGateCommandPayload(stdOut[0]);
    expect(gate.thresholds.maxRiskScore).toBe(99);
    expect(gate.thresholds.maxComplexityScore).toBe(98);
    expect(gate.thresholds.minConfidence).toBe(0.75);
    expect(gate.thresholds.maxUnresolvedDependencies).toBe(1);
    expect(commandPayload.policyUsed).toBe(policyPath);
    expect(commandPayload.profileUsed).toBe("strict");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("fails clearly when policy schema is invalid", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-invalid-policy");
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const invalidPolicyPath = path.join(tempRoot, "invalid.policy.json");
    await writeFile(
      invalidPolicyPath,
      `${JSON.stringify({ schemaVersion: "1.0", profiles: [] }, null, 2)}\n`,
      "utf-8"
    );

    expect(
      await runCli(
        ["gate", outputFolder, "--policy", invalidPolicyPath],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(1);
    expect(stdErr[0]).toContain('"code":"GATE_POLICY_VALIDATION_FAILURE"');

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("fails clearly when requested policy profile is missing", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-missing-profile");
    const stdErr: string[] = [];

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    const policyPath = await writePolicyFile({
      rootFolder: tempRoot,
      profiles: [
        makePolicyProfile("dev", {
          maxRiskScore: 80,
          maxComplexityScore: 80,
          minConfidence: 0.5,
          allowCriticalUnsupported: true,
          maxUnresolvedDependencies: 20,
          maxHighSeverityFindings: 20,
          requireNoBlockers: false
        })
      ]
    });

    expect(
      await runCli(
        ["gate", outputFolder, "--policy", policyPath, "--profile", "prod"],
        () => undefined,
        stdErr.push.bind(stdErr)
      )
    ).toBe(1);
    expect(stdErr[0]).toContain('"code":"GATE_POLICY_PROFILE_NOT_FOUND"');

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("applies valid waivers and keeps waived evidence visible in markdown", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-waiver-valid");

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    await appendCriticalUnsupportedFeature(outputFolder);
    const policyPath = await writePolicyFile({
      rootFolder: tempRoot,
      profiles: [
        makePolicyProfile(
          "prod",
          {
            maxRiskScore: 100,
            maxComplexityScore: 100,
            minConfidence: 0,
            allowCriticalUnsupported: false,
            maxUnresolvedDependencies: 99,
            maxHighSeverityFindings: 99,
            requireNoBlockers: false
          },
          {
            allowedWaivers: [
              {
                waiverId: "WVR-001",
                appliesTo: {
                  unsupportedFeatureId: "critical.synthetic.feature:synthetic/source"
                },
                reason: "Approved migration exception for first release cut.",
                owner: "migration-team",
                expiresOn: "2099-12-31",
                approvedBy: "risk-board",
                evidenceLink: "https://contoso.example/risk/WVR-001",
                riskAccepted: true,
                createdOn: "2026-05-28"
              }
            ]
          }
        )
      ]
    });

    expect(
      await runCli(
        ["gate", outputFolder, "--policy", policyPath, "--profile", "prod"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);

    const gate = await parseReadinessGate(outputFolder);
    const markdown = await readFile(path.join(outputFolder, "readiness-gate.md"), "utf-8");
    expect(gate.originalStatus).toBe("fail");
    expect(gate.effectiveStatus).toBe("warn");
    expect(gate.status).toBe("warn");
    expect(gate.waiverAudit.waivedCount).toBeGreaterThan(0);
    expect(markdown).toContain("critical.synthetic.feature at synthetic/source");
    expect(markdown).toContain("waived by: WVR-001");

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("ignores expired waivers and reports invalid critical waivers without risk acceptance", async () => {
    const tempRoot = await createTempDirectory();
    const outputFolder = path.join(tempRoot, "gate-waiver-expired-invalid");

    expect(
      await runCli(
        ["analyse", fixturePath("minimal-valid"), "--out", outputFolder],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    await writeMinimalGenerationPlan(outputFolder);
    await appendCriticalUnsupportedFeature(outputFolder);
    const policyPath = await writePolicyFile({
      rootFolder: tempRoot,
      profiles: [
        makePolicyProfile(
          "prod",
          {
            maxRiskScore: 100,
            maxComplexityScore: 100,
            minConfidence: 0,
            allowCriticalUnsupported: false,
            maxUnresolvedDependencies: 99,
            maxHighSeverityFindings: 99,
            requireNoBlockers: false
          },
          {
            allowedWaivers: [
              {
                waiverId: "WVR-EXPIRED",
                appliesTo: {
                  unsupportedFeatureId: "critical.synthetic.feature:synthetic/source"
                },
                reason: "Expired exception",
                owner: "migration-team",
                expiresOn: "2020-01-01",
                approvedBy: "risk-board",
                evidenceLink: "https://contoso.example/risk/WVR-EXPIRED",
                riskAccepted: true,
                createdOn: "2020-01-01"
              },
              {
                waiverId: "WVR-NO-RISK-ACCEPT",
                appliesTo: {
                  unsupportedFeatureId: "critical.synthetic.feature:synthetic/source"
                },
                reason: "Missing risk acceptance",
                owner: "migration-team",
                expiresOn: "2099-12-31",
                approvedBy: "risk-board",
                evidenceLink: "https://contoso.example/risk/WVR-NO-RISK-ACCEPT",
                riskAccepted: false,
                createdOn: "2026-05-28"
              }
            ]
          }
        )
      ]
    });

    expect(
      await runCli(
        ["gate", outputFolder, "--policy", policyPath, "--profile", "prod"],
        () => undefined,
        () => undefined
      )
    ).toBe(0);
    const gate = await parseReadinessGate(outputFolder);
    expect(gate.status).toBe("fail");
    expect(gate.waiverAudit.waivedCount).toBe(0);
    expect(gate.waiverAudit.expiredCount).toBe(1);
    expect(gate.waiverAudit.invalidCount).toBe(1);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns structured error for missing output folder input", async () => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    expect(
      await runCli(
        ["gate", "/tmp/power-exit-gate-missing-folder"],
        stdOut.push.bind(stdOut),
        stdErr.push.bind(stdErr)
      )
    ).toBe(1);
    expect(stdOut).toEqual([]);
    expect(stdErr[0]).toContain('"code":"INPUT_FOLDER_NOT_FOUND"');
  });
});

describe("power-exit init-policy command", () => {
  it("writes default policy json and markdown deterministically", async () => {
    const tempRoot = await createTempDirectory();
    const outputA = path.join(tempRoot, "policy-a");
    const outputB = path.join(tempRoot, "policy-b");

    expect(await runCli(["init-policy", "--out", outputA], () => undefined, () => undefined)).toBe(
      0
    );
    expect(await runCli(["init-policy", "--out", outputB], () => undefined, () => undefined)).toBe(
      0
    );

    const policyJsonA = await readFile(path.join(outputA, "power-exit.policy.json"), "utf-8");
    const policyJsonB = await readFile(path.join(outputB, "power-exit.policy.json"), "utf-8");
    const policyMdA = await readFile(path.join(outputA, "power-exit.policy.md"), "utf-8");
    const policyMdB = await readFile(path.join(outputB, "power-exit.policy.md"), "utf-8");
    const parsedPolicy = JSON.parse(policyJsonA) as {
      schemaVersion: string;
      profiles: Array<{ profileName: string }>;
    };

    expect(policyJsonA).toBe(policyJsonB);
    expect(policyMdA).toBe(policyMdB);
    expect(parsedPolicy.schemaVersion).toBe("1.0");
    expect(parsedPolicy.profiles.map((profile) => profile.profileName)).toEqual([
      "dev",
      "test",
      "prod",
      "strict"
    ]);
    expect(policyMdA).toContain("## Profiles");

    await rm(tempRoot, { recursive: true, force: true });
  });
});

