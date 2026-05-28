import { readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  sortByStableKey,
  stableStringify,
  type PowerPlatformIR,
  type UnsupportedFeature
} from "@power-exit/ir";
import {
  sortFindings,
  type MigrationAssessment,
  type AssessmentFinding,
  type ReadinessGate
} from "@power-exit/assessment";
import { type GenerationPlan } from "@power-exit/generators";

const clientPackAssetCategorySchema = z.enum([
  "sql",
  "react",
  "functions",
  "infra",
  "reports",
  "plans",
  "gate",
  "other"
]);

export type ClientPackAssetCategory = z.infer<typeof clientPackAssetCategorySchema>;

export const clientPackAssetEntrySchema = z
  .object({
    category: clientPackAssetCategorySchema,
    relativePath: z.string().min(1),
    purpose: z.string().min(1)
  })
  .strict();

export type ClientPackAssetEntry = z.infer<typeof clientPackAssetEntrySchema>;

export const clientPackSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    sourceOutputFolder: z.string().min(1),
    solution: z
      .object({
        name: z.string().min(1),
        uniqueName: z.string().min(1),
        version: z.string().min(1)
      })
      .strict(),
    overallReadiness: z.string().min(1),
    gateStatus: z.enum(["pass", "warn", "fail"]).nullable(),
    headlineMetrics: z
      .object({
        riskScore: z.number().int().min(0).max(100),
        complexityScore: z.number().int().min(0).max(100),
        confidence: z.number().min(0).max(1)
      })
      .strict(),
    counts: z
      .object({
        filesScanned: z.number().int().nonnegative(),
        entities: z.number().int().nonnegative(),
        canvasApps: z.number().int().nonnegative(),
        flows: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        unsupportedFeatures: z.number().int().nonnegative()
      })
      .strict(),
    generatedSections: z
      .object({
        executiveSummary: z.literal("executive-summary.md"),
        technicalFindings: z.literal("technical-findings.md"),
        migrationRoadmap: z.literal("migration-roadmap.md"),
        riskRegister: z.literal("risk-register.md"),
        quickWins: z.literal("quick-wins.md"),
        unsupportedFeatures: z.literal("unsupported-features.md"),
        manualReviewLog: z.literal("manual-review-log.md"),
        generatedAssetsIndex: z.literal("generated-assets-index.md")
      })
      .strict(),
    sourceAssets: z.array(clientPackAssetEntrySchema),
    optionalInputs: z
      .object({
        generationPlanAvailable: z.boolean(),
        readinessGateAvailable: z.boolean(),
        migrationPlanAvailable: z.boolean(),
        assessmentReportAvailable: z.boolean()
      })
      .strict()
  })
  .strict();

export type ClientPack = z.infer<typeof clientPackSchema>;

export interface BuildClientPackInput {
  sourceOutputFolder: string;
  ir: PowerPlatformIR;
  assessment: MigrationAssessment;
  generationPlan: GenerationPlan | null;
  readinessGate: ReadinessGate | null;
}

export interface BuiltClientPack {
  pack: ClientPack;
  files: Array<{ path: string; content: string }>;
}

const severityRank: Record<AssessmentFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};

interface RiskEntry {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  likelihood: "High" | "Medium" | "Low";
  impact: string;
  affectedArtefacts: string[];
  mitigation: string;
}

const listOrNone = (entries: readonly string[]): string[] =>
  entries.length > 0 ? [...entries] : ["None identified."];

const toMarkdownBullets = (entries: readonly string[]): string =>
  listOrNone(entries).map((entry) => `- ${entry}`).join("\n");

const extractSourceFiles = async (
  sourceOutputFolder: string,
  currentFolder = sourceOutputFolder
): Promise<string[]> => {
  const entries = sortByStableKey(
    await readdir(currentFolder, { withFileTypes: true }),
    (entry) => entry.name
  );
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentFolder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await extractSourceFiles(sourceOutputFolder, absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(path.relative(sourceOutputFolder, absolutePath).replaceAll(path.sep, "/"));
  }

  return files;
};

const categoryForPath = (relativePath: string): ClientPackAssetCategory => {
  if (relativePath.startsWith("sql/")) {
    return "sql";
  }
  if (relativePath.startsWith("react/")) {
    return "react";
  }
  if (relativePath.startsWith("functions/")) {
    return "functions";
  }
  if (relativePath.startsWith("infra/")) {
    return "infra";
  }
  if (relativePath === "readiness-gate.json" || relativePath === "readiness-gate.md") {
    return "gate";
  }
  if (
    relativePath === "generation-plan.json" ||
    relativePath === "generation-plan.md" ||
    relativePath === "migration-plan.md"
  ) {
    return "plans";
  }
  if (
    relativePath === "assessment-report.md" ||
    relativePath.endsWith("/generation-report.md") ||
    relativePath.endsWith("/migration-notes.md") ||
    relativePath === "ir.json"
  ) {
    return "reports";
  }

  return "other";
};

const purposeForPath = (relativePath: string): string => {
  if (relativePath === "ir.json") {
    return "Validated typed migration intermediate representation.";
  }
  if (relativePath === "assessment-report.md") {
    return "Detailed technical migration assessment report.";
  }
  if (relativePath === "migration-plan.md") {
    return "Master migration plan for phased delivery.";
  }
  if (relativePath === "generation-plan.json") {
    return "Machine-readable generation planning summary.";
  }
  if (relativePath === "generation-plan.md") {
    return "Human-readable generation planning summary.";
  }
  if (relativePath === "readiness-gate.json") {
    return "Machine-readable readiness gate decision and evidence.";
  }
  if (relativePath === "readiness-gate.md") {
    return "Human-readable readiness gate rationale.";
  }
  if (relativePath === "sql/schema.sql") {
    return "Generated Azure SQL DDL scaffold.";
  }
  if (relativePath.endsWith("/generation-report.md")) {
    return "Generator-specific output report.";
  }
  if (relativePath.endsWith("/migration-notes.md")) {
    return "Generator-specific manual migration notes.";
  }
  if (relativePath.endsWith(".bicep")) {
    return "Azure infrastructure scaffold module.";
  }
  if (relativePath.endsWith(".tsx")) {
    return "React migration scaffold component.";
  }
  if (relativePath.endsWith(".ts")) {
    return "TypeScript scaffold for generated adapter or function logic.";
  }
  if (relativePath.endsWith(".json")) {
    return "Machine-readable generated artifact.";
  }

  return "Generated migration artifact.";
};

const toAssetEntries = (sourceFiles: readonly string[]): ClientPackAssetEntry[] =>
  sortByStableKey(
    sourceFiles.map((relativePath) => ({
      category: categoryForPath(relativePath),
      relativePath,
      purpose: purposeForPath(relativePath)
    })),
    (entry) => `${entry.category}:${entry.relativePath}`
  );

const likelihoodFromSeverity = (
  severity: "critical" | "high" | "medium" | "low"
): "High" | "Medium" | "Low" => {
  if (severity === "critical" || severity === "high") {
    return "High";
  }
  if (severity === "medium") {
    return "Medium";
  }
  return "Low";
};

const riskFromFinding = (finding: AssessmentFinding): RiskEntry => ({
  title: finding.title,
  severity:
    finding.severity === "critical" ||
    finding.severity === "high" ||
    finding.severity === "medium"
      ? finding.severity
      : "low",
  likelihood:
    finding.severity === "critical" ||
    finding.severity === "high" ||
    finding.severity === "medium"
      ? likelihoodFromSeverity(finding.severity)
      : "Low",
  impact: finding.evidence,
  affectedArtefacts: finding.affectedArtifactIds,
  mitigation: finding.recommendation
});

const riskFromUnsupportedFeature = (feature: UnsupportedFeature): RiskEntry => ({
  title: `Unsupported feature: ${feature.featureType}`,
  severity: feature.severity,
  likelihood: likelihoodFromSeverity(feature.severity),
  impact: feature.reason,
  affectedArtefacts: [feature.sourceLocation],
  mitigation: feature.suggestedRemediation
});

const toRiskEntries = (input: {
  assessment: MigrationAssessment;
  ir: PowerPlatformIR;
  generationPlan: GenerationPlan | null;
}): RiskEntry[] => {
  const findingRisks = sortFindings(input.assessment.findings)
    .filter((finding) => finding.severity !== "info")
    .map(riskFromFinding);
  const unsupportedRisks = sortByStableKey(
    input.ir.unsupportedFeatures,
    (feature) => `${feature.severity}:${feature.featureType}:${feature.sourceLocation}`
  ).map(riskFromUnsupportedFeature);
  const dependencyRisks: RiskEntry[] = [];
  if (input.ir.analysisSummary.unresolvedDependencies > 0) {
    dependencyRisks.push({
      title: "Unresolved migration dependencies",
      severity: input.ir.analysisSummary.unresolvedDependencies > 5 ? "high" : "medium",
      likelihood: input.ir.analysisSummary.unresolvedDependencies > 5 ? "High" : "Medium",
      impact: `Detected ${input.ir.analysisSummary.unresolvedDependencies} unresolved dependency references.`,
      affectedArtefacts: ["ir.json"],
      mitigation: "Resolve unresolved references and validate dependency graph before implementation."
    });
  }
  input.generationPlan?.functionsPlan?.unresolvedDependencies.forEach((dependency) => {
    dependencyRisks.push({
      title: `Functions unresolved dependency: ${dependency.referenceName}`,
      severity: "high",
      likelihood: "High",
      impact: `${dependency.referenceType}:${dependency.referenceName} remains unresolved for scaffold execution.`,
      affectedArtefacts: [dependency.sourceArtifactId],
      mitigation: "Implement or map missing dependency before production implementation."
    });
  });

  return sortByStableKey(
    [...findingRisks, ...unsupportedRisks, ...dependencyRisks],
    (risk) =>
      `${severityRank[risk.severity === "low" ? "low" : (risk.severity as AssessmentFinding["severity"])]}:${risk.title}:${risk.impact}`
  );
};

const recommendationFromStatus = (status: "pass" | "warn" | "fail" | null): string => {
  if (status === "fail") {
    return "Pause migration execution and prioritize blocker remediation before committing to build scope.";
  }
  if (status === "warn") {
    return "Proceed with a controlled discovery sprint and explicit governance sign-off for known risks.";
  }
  if (status === "pass") {
    return "Proceed to pilot migration implementation while tracking residual manual review actions.";
  }

  return "Complete remediation discovery and produce a readiness gate decision before committing delivery timelines.";
};

const nextDecisionFromStatus = (status: "pass" | "warn" | "fail" | null): string => {
  if (status === "fail") {
    return "Approve a remediation-first phase and defer migration commitment decisions.";
  }
  if (status === "warn") {
    return "Approve a constrained pilot with explicit risk ownership and checkpoint reviews.";
  }
  if (status === "pass") {
    return "Approve progression to Wave 1 implementation planning.";
  }

  return "Approve completion of migration governance evidence and rerun readiness gate.";
};

const renderExecutiveSummary = (input: {
  ir: PowerPlatformIR;
  assessment: MigrationAssessment;
  readinessGate: ReadinessGate | null;
}): string => {
  const gateStatus = input.readinessGate?.effectiveStatus ?? null;
  const topBlockers = sortFindings(input.assessment.blockers)
    .slice(0, 5)
    .map((blocker) => blocker.title);
  const topQuickWins = sortFindings(input.assessment.quickWins)
    .slice(0, 5)
    .map((quickWin) => quickWin.title);
  const lines: string[] = [];
  lines.push("# Client Pack Executive Summary");
  lines.push("");
  lines.push("## What was scanned");
  lines.push("");
  lines.push(`- Solution: ${input.ir.solution.name} (${input.ir.solution.uniqueName})`);
  lines.push(`- Version: ${input.ir.solution.version}`);
  lines.push(`- Files scanned: ${input.ir.analysisSummary.filesScanned}`);
  lines.push(
    `- Scope highlights: ${input.ir.analysisSummary.entities} Dataverse entities, ${input.ir.analysisSummary.canvasApps} Canvas apps, ${input.ir.analysisSummary.flows} Cloud flows`
  );
  lines.push("");
  lines.push("## Overall readiness snapshot");
  lines.push("");
  lines.push(`- Readiness: ${input.assessment.overallReadiness}`);
  lines.push(`- Effective gate status: ${gateStatus ?? "not evaluated"}`);
  lines.push(`- Risk score: ${input.assessment.overallRiskScore}/100`);
  lines.push(`- Complexity score: ${input.assessment.overallComplexityScore}/100`);
  lines.push(`- Confidence: ${input.assessment.overallConfidence.toFixed(2)}`);
  lines.push("");
  lines.push("## Key blockers");
  lines.push("");
  lines.push(toMarkdownBullets(topBlockers));
  lines.push("");
  lines.push("## Top quick wins");
  lines.push("");
  lines.push(toMarkdownBullets(topQuickWins));
  lines.push("");
  lines.push("## High-level recommendation");
  lines.push("");
  lines.push(`- ${recommendationFromStatus(gateStatus)}`);
  lines.push("");
  lines.push("## Suggested next decision");
  lines.push("");
  lines.push(`- ${nextDecisionFromStatus(gateStatus)}`);
  lines.push("");

  return `${lines.join("\n")}`;
};

const renderFindingsSection = (input: {
  title: string;
  findings: AssessmentFinding[];
}): string => {
  const lines: string[] = [];
  lines.push(`## ${input.title}`);
  lines.push("");
  if (input.findings.length === 0) {
    lines.push("- None.");
  } else {
    sortFindings(input.findings).forEach((finding) => {
      lines.push(
        `- [${finding.severity}] ${finding.title} — ${finding.evidence} (artifacts: ${finding.affectedArtifactIds.join(", ") || "none"})`
      );
    });
  }
  lines.push("");
  return lines.join("\n");
};

const renderTechnicalFindings = (input: {
  ir: PowerPlatformIR;
  assessment: MigrationAssessment;
  generationPlan: GenerationPlan | null;
  readinessGate: ReadinessGate | null;
  sourceAssets: ClientPackAssetEntry[];
}): string => {
  const lines: string[] = [];
  lines.push("# Technical Findings");
  lines.push("");
  lines.push(
    renderFindingsSection({
      title: "Dataverse findings",
      findings: input.assessment.domainAssessments.dataverse.findings
    })
  );
  lines.push(
    renderFindingsSection({
      title: "Canvas findings",
      findings: input.assessment.domainAssessments.canvas.findings
    })
  );
  lines.push(
    renderFindingsSection({
      title: "Flow findings",
      findings: input.assessment.domainAssessments.cloudFlows.findings
    })
  );
  lines.push(
    renderFindingsSection({
      title: "Security findings",
      findings: input.assessment.domainAssessments.security.findings
    })
  );
  lines.push(
    renderFindingsSection({
      title: "Connection/dependency findings",
      findings: [
        ...input.assessment.domainAssessments.connections.findings,
        ...input.assessment.domainAssessments.dependencies.findings
      ]
    })
  );

  lines.push("## Generation readiness");
  lines.push("");
  if (input.generationPlan === null) {
    lines.push("- generation-plan.json not available; generation readiness signals are limited.");
  } else {
    lines.push(`- Planned files: ${input.generationPlan.summary.totalPlannedFiles}`);
    lines.push(
      `- Plan actions: create=${input.generationPlan.summary.creates}, overwrite=${input.generationPlan.summary.overwrites}, skip=${input.generationPlan.summary.skips}`
    );
    if (input.generationPlan.functionsPlan !== null) {
      lines.push(
        `- Functions readiness: blocked=${input.generationPlan.functionsPlan.deploymentReadiness.blocked}, needsConfig=${input.generationPlan.functionsPlan.deploymentReadiness.needsConfig}, needsManualLogic=${input.generationPlan.functionsPlan.deploymentReadiness.needsManualLogic}`
      );
    }
    if (input.generationPlan.infraPlan !== null) {
      lines.push(
        `- Infra readiness: blocked=${input.generationPlan.infraPlan.deploymentReadiness.blocked}, needsConfig=${input.generationPlan.infraPlan.deploymentReadiness.needsConfig}, needsSecurityReview=${input.generationPlan.infraPlan.deploymentReadiness.needsSecurityReview}`
      );
    }
  }
  lines.push(`- Gate status: ${input.readinessGate?.effectiveStatus ?? "not evaluated"}`);
  lines.push("");

  lines.push("## Unresolved dependencies");
  lines.push("");
  lines.push(
    `- IR unresolved dependencies: ${input.ir.analysisSummary.unresolvedDependencies}`
  );
  const unresolvedEntries = [
    ...(input.generationPlan?.functionsPlan?.unresolvedDependencies.map(
      (dependency) =>
        `${dependency.referenceType}:${dependency.referenceName} (${dependency.sourceArtifactId})`
    ) ?? []),
    ...(input.generationPlan?.functionsPlan?.unresolvedAdapterRequirements.map(
      (requirement) => `${requirement.connectorKey}: ${requirement.requirement}`
    ) ?? [])
  ];
  lines.push(toMarkdownBullets(unresolvedEntries));
  lines.push("");

  lines.push("## Evidence references");
  lines.push("");
  const evidencePaths = input.sourceAssets
    .filter((entry) =>
      [
        "ir.json",
        "assessment-report.md",
        "migration-plan.md",
        "generation-plan.json",
        "generation-plan.md",
        "readiness-gate.json",
        "readiness-gate.md"
      ].includes(entry.relativePath)
    )
    .map((entry) => `${entry.relativePath} — ${entry.purpose}`);
  lines.push(toMarkdownBullets(evidencePaths));
  lines.push("");

  return lines.join("\n");
};

interface RoadmapWave {
  heading: string;
  objective: string;
  candidateArtefacts: string[];
  risks: string[];
  prerequisites: string[];
  suggestedOutputs: string[];
}

const toRoadmapWaves = (input: {
  ir: PowerPlatformIR;
  assessment: MigrationAssessment;
  generationPlan: GenerationPlan | null;
}): RoadmapWave[] => {
  const dataverseCandidates = input.ir.dataverse.entities
    .slice(0, 8)
    .map((entity) => entity.logicalName);
  const simpleCanvasScreens = input.ir.canvasApps
    .flatMap((app) =>
      app.screens
        .filter(
          (screen) =>
            screen.migrationReadiness === "high" || screen.migrationReadiness === "medium"
        )
        .map((screen) => `${app.appName}:${screen.screenName}`)
    )
    .slice(0, 8);
  const complexCanvasScreens = input.ir.canvasApps
    .flatMap((app) =>
      app.screens
        .filter(
          (screen) =>
            screen.migrationReadiness === "low" || screen.migrationReadiness === "blocked"
        )
        .map((screen) => `${app.appName}:${screen.screenName}`)
    )
    .slice(0, 8);
  const simpleFlows = input.ir.cloudFlows
    .filter((flow) => flow.migrationReadiness === "high" || flow.migrationReadiness === "medium")
    .map((flow) => flow.displayName)
    .slice(0, 8);
  const complexFlows = input.ir.cloudFlows
    .filter((flow) => flow.migrationReadiness === "low" || flow.migrationReadiness === "blocked")
    .map((flow) => flow.displayName)
    .slice(0, 8);

  return [
    {
      heading: "Wave 0 discovery/remediation",
      objective:
        "Confirm migration boundaries, resolve blocker evidence, and establish governance sign-off criteria.",
      candidateArtefacts: sortFindings(input.assessment.blockers)
        .slice(0, 8)
        .map((blocker) => blocker.title),
      risks: [
        `${input.assessment.blockers.length} blocker(s) may delay implementation start.`,
        `${input.ir.unsupportedFeatures.length} unsupported feature(s) require explicit treatment.`
      ],
      prerequisites: [
        "Agree ownership for blocker remediation.",
        "Confirm target architecture constraints and non-functional requirements."
      ],
      suggestedOutputs: [
        "Remediation backlog with ownership.",
        "Signed governance checkpoint criteria.",
        "Updated readiness gate run with policy profile."
      ]
    },
    {
      heading: "Wave 1 Dataverse/schema",
      objective:
        "Deliver foundational Dataverse-to-Azure SQL schema migration and core data model parity.",
      candidateArtefacts: dataverseCandidates,
      risks: [
        "Schema edge cases (relationships, unsupported columns) can require manual design decisions.",
        "Data quality gaps may affect confidence and migration ordering."
      ],
      prerequisites: [
        "Approved data model mapping strategy.",
        "Environment and identity standards confirmed."
      ],
      suggestedOutputs: [
        "Reviewed SQL DDL baseline.",
        "Data migration validation checklist.",
        "Entity-by-entity parity tracker."
      ]
    },
    {
      heading: "Wave 2 simple Canvas/Flow",
      objective:
        "Migrate lower-complexity user journeys and automations to accelerate visible progress.",
      candidateArtefacts: [...simpleCanvasScreens, ...simpleFlows],
      risks: [
        "UI parity assumptions may hide interaction differences.",
        "Connector mappings may require integration revalidation."
      ],
      prerequisites: [
        "Front-end scaffold acceptance criteria agreed.",
        "API contract and connector ownership assigned."
      ],
      suggestedOutputs: [
        "Pilot React screen implementations.",
        "Pilot Functions handlers for simple flows.",
        "User validation walkthrough for migrated journeys."
      ]
    },
    {
      heading: "Wave 3 complex Canvas/Flow",
      objective:
        "Address complex formulas, advanced control interactions, and non-trivial orchestration logic.",
      candidateArtefacts: [...complexCanvasScreens, ...complexFlows],
      risks: [
        "Complex Power Fx and orchestration logic increases delivery uncertainty.",
        "Manual implementation hotspots can drive significant engineering effort."
      ],
      prerequisites: [
        "Technical spike outcomes captured.",
        "Manual conversion strategy approved."
      ],
      suggestedOutputs: [
        "Complex logic implementation plan.",
        "Integration and regression test scenarios.",
        "Updated migration roadmap for residual scope."
      ]
    },
    {
      heading: "Wave 4 manual architecture decisions",
      objective:
        "Close remaining architecture, security, and operations decisions before production readiness.",
      candidateArtefacts: [
        ...(input.generationPlan?.manualReviewItems
          .filter((item) => item.severity === "high" || item.severity === "critical")
          .slice(0, 8)
          .map((item) => item.message) ?? []),
        `Unresolved dependencies: ${input.ir.analysisSummary.unresolvedDependencies}`
      ],
      risks: [
        "Security and infrastructure hardening decisions may change delivery sequencing.",
        "Non-waivable governance constraints can block release readiness."
      ],
      prerequisites: [
        "Architecture and security review board availability.",
        "Operational ownership model agreed."
      ],
      suggestedOutputs: [
        "Architecture decision records (ADRs).",
        "Production hardening checklist.",
        "Final go/no-go readiness recommendation."
      ]
    }
  ];
};

const renderMigrationRoadmap = (input: {
  ir: PowerPlatformIR;
  assessment: MigrationAssessment;
  generationPlan: GenerationPlan | null;
}): string => {
  const waves = toRoadmapWaves(input);
  const lines: string[] = [];
  lines.push("# Migration Roadmap");
  lines.push("");

  for (const wave of waves) {
    lines.push(`## ${wave.heading}`);
    lines.push("");
    lines.push(`- objective: ${wave.objective}`);
    lines.push("- candidate artefacts:");
    toMarkdownBullets(wave.candidateArtefacts).split("\n").forEach((entry) => lines.push(`  ${entry}`));
    lines.push("- risks:");
    toMarkdownBullets(wave.risks).split("\n").forEach((entry) => lines.push(`  ${entry}`));
    lines.push("- prerequisites:");
    toMarkdownBullets(wave.prerequisites).split("\n").forEach((entry) => lines.push(`  ${entry}`));
    lines.push("- suggested engineering outputs:");
    toMarkdownBullets(wave.suggestedOutputs).split("\n").forEach((entry) => lines.push(`  ${entry}`));
    lines.push("");
  }

  return lines.join("\n");
};

const renderRiskRegister = (entries: RiskEntry[]): string => {
  const lines: string[] = [];
  lines.push("# Risk Register");
  lines.push("");
  lines.push(
    "| risk id | title | severity | likelihood | impact | affected artefacts | mitigation | owner placeholder | status placeholder |"
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  if (entries.length === 0) {
    lines.push(
      "| RISK-000 | No material risks identified | low | Low | No material risk evidence identified in current output. | none | Continue periodic reassessment. | TBD | Open |"
    );
  } else {
    entries.forEach((entry, index) => {
      const riskId = `RISK-${String(index + 1).padStart(3, "0")}`;
      lines.push(
        `| ${riskId} | ${entry.title} | ${entry.severity} | ${entry.likelihood} | ${entry.impact} | ${entry.affectedArtefacts.join(", ") || "none"} | ${entry.mitigation} | TBD | Open |`
      );
    });
  }
  lines.push("");
  return lines.join("\n");
};

const renderQuickWins = (assessment: MigrationAssessment): string => {
  const quickWins = sortFindings(assessment.quickWins);
  const lines: string[] = [];
  lines.push("# Quick Wins");
  lines.push("");
  if (quickWins.length === 0) {
    lines.push("- No quick wins identified in current assessment.");
    lines.push("");
    return lines.join("\n");
  }

  quickWins.forEach((quickWin, index) => {
    lines.push(`## Quick win ${index + 1}: ${quickWin.title}`);
    lines.push("");
    lines.push(`- severity: ${quickWin.severity}`);
    lines.push(`- description: ${quickWin.description}`);
    lines.push(`- evidence: ${quickWin.evidence}`);
    lines.push(`- mitigation/action: ${quickWin.recommendation}`);
    lines.push("");
  });

  return lines.join("\n");
};

const renderUnsupportedFeatures = (unsupportedFeatures: readonly UnsupportedFeature[]): string => {
  const lines: string[] = [];
  lines.push("# Unsupported Features");
  lines.push("");
  if (unsupportedFeatures.length === 0) {
    lines.push("- No unsupported features were detected.");
    lines.push("");
    return lines.join("\n");
  }

  sortByStableKey(
    unsupportedFeatures,
    (feature) => `${feature.severity}:${feature.featureType}:${feature.sourceLocation}`
  ).forEach((feature) => {
    lines.push(
      `- [${feature.severity}] ${feature.featureType} at ${feature.sourceLocation} — ${feature.reason} (remediation: ${feature.suggestedRemediation})`
    );
  });
  lines.push("");
  return lines.join("\n");
};

const renderManualReviewLog = (input: {
  generationPlan: GenerationPlan | null;
  readinessGate: ReadinessGate | null;
}): string => {
  const lines: string[] = [];
  lines.push("# Manual Review Log");
  lines.push("");
  lines.push("## Generation manual review items");
  lines.push("");
  const reviewItems =
    input.generationPlan?.manualReviewItems.map(
      (item) =>
        `[${item.severity}] ${item.category} (${item.id}) — ${item.message}${
          item.relatedPaths.length > 0 ? ` (paths: ${item.relatedPaths.join(", ")})` : ""
        }`
    ) ?? [];
  lines.push(toMarkdownBullets(reviewItems));
  lines.push("");
  lines.push("## Gate waiver audit");
  lines.push("");
  if (input.readinessGate === null) {
    lines.push("- readiness-gate.json not available.");
  } else {
    lines.push(
      `- applied waivers: ${input.readinessGate.waiverAudit.waivedCount}`
    );
    lines.push(
      `- expired waivers: ${input.readinessGate.waiverAudit.expiredCount}`
    );
    lines.push(
      `- invalid waivers: ${input.readinessGate.waiverAudit.invalidCount}`
    );
    const waiverEvents = [
      ...input.readinessGate.waiverAudit.expiredWaivers.map(
        (entry) => `expired ${entry.waiverId}: ${entry.reason}`
      ),
      ...input.readinessGate.waiverAudit.invalidWaivers.map(
        (entry) => `invalid ${entry.waiverId}: ${entry.reason}`
      )
    ];
    lines.push(toMarkdownBullets(waiverEvents));
  }
  lines.push("");
  return lines.join("\n");
};

const renderGeneratedAssetsIndex = (assetEntries: readonly ClientPackAssetEntry[]): string => {
  const sectionOrder: Array<{
    category: ClientPackAssetCategory;
    title: string;
  }> = [
    { category: "sql", title: "SQL outputs" },
    { category: "react", title: "React outputs" },
    { category: "functions", title: "Functions outputs" },
    { category: "infra", title: "Infra outputs" },
    { category: "reports", title: "reports" },
    { category: "plans", title: "plans" },
    { category: "gate", title: "gate files" }
  ];
  const lines: string[] = [];
  lines.push("# Generated Assets Index");
  lines.push("");

  for (const section of sectionOrder) {
    const sectionEntries = assetEntries.filter((entry) => entry.category === section.category);
    lines.push(`## ${section.title}`);
    lines.push("");
    if (sectionEntries.length === 0) {
      lines.push("- None.");
    } else {
      sectionEntries.forEach((entry) =>
        lines.push(`- \`${entry.relativePath}\` — ${entry.purpose}`)
      );
    }
    lines.push("");
  }

  return lines.join("\n");
};

export const buildClientPack = async (
  input: BuildClientPackInput
): Promise<BuiltClientPack> => {
  const sourceFiles = await extractSourceFiles(input.sourceOutputFolder);
  const sourceAssets = toAssetEntries(sourceFiles);
  const riskEntries = toRiskEntries({
    assessment: input.assessment,
    ir: input.ir,
    generationPlan: input.generationPlan
  });

  const files: Array<{ path: string; content: string }> = [
    {
      path: "executive-summary.md",
      content: `${renderExecutiveSummary({
        ir: input.ir,
        assessment: input.assessment,
        readinessGate: input.readinessGate
      })}\n`
    },
    {
      path: "technical-findings.md",
      content: `${renderTechnicalFindings({
        ir: input.ir,
        assessment: input.assessment,
        generationPlan: input.generationPlan,
        readinessGate: input.readinessGate,
        sourceAssets
      })}\n`
    },
    {
      path: "migration-roadmap.md",
      content: `${renderMigrationRoadmap({
        ir: input.ir,
        assessment: input.assessment,
        generationPlan: input.generationPlan
      })}\n`
    },
    {
      path: "risk-register.md",
      content: `${renderRiskRegister(riskEntries)}\n`
    },
    {
      path: "quick-wins.md",
      content: `${renderQuickWins(input.assessment)}\n`
    },
    {
      path: "unsupported-features.md",
      content: `${renderUnsupportedFeatures(input.ir.unsupportedFeatures)}\n`
    },
    {
      path: "manual-review-log.md",
      content: `${renderManualReviewLog({
        generationPlan: input.generationPlan,
        readinessGate: input.readinessGate
      })}\n`
    },
    {
      path: "generated-assets-index.md",
      content: `${renderGeneratedAssetsIndex(sourceAssets)}\n`
    }
  ];

  const pack = clientPackSchema.parse({
    schemaVersion: "1.0",
    sourceOutputFolder: input.sourceOutputFolder,
    solution: {
      name: input.ir.solution.name,
      uniqueName: input.ir.solution.uniqueName,
      version: input.ir.solution.version
    },
    overallReadiness: input.assessment.overallReadiness,
    gateStatus: input.readinessGate?.effectiveStatus ?? null,
    headlineMetrics: {
      riskScore: input.assessment.overallRiskScore,
      complexityScore: input.assessment.overallComplexityScore,
      confidence: input.assessment.overallConfidence
    },
    counts: {
      filesScanned: input.ir.analysisSummary.filesScanned,
      entities: input.ir.analysisSummary.entities,
      canvasApps: input.ir.analysisSummary.canvasApps,
      flows: input.ir.analysisSummary.flows,
      warnings: input.ir.warnings.length,
      unsupportedFeatures: input.ir.unsupportedFeatures.length
    },
    generatedSections: {
      executiveSummary: "executive-summary.md",
      technicalFindings: "technical-findings.md",
      migrationRoadmap: "migration-roadmap.md",
      riskRegister: "risk-register.md",
      quickWins: "quick-wins.md",
      unsupportedFeatures: "unsupported-features.md",
      manualReviewLog: "manual-review-log.md",
      generatedAssetsIndex: "generated-assets-index.md"
    },
    sourceAssets,
    optionalInputs: {
      generationPlanAvailable: sourceFiles.includes("generation-plan.json"),
      readinessGateAvailable: sourceFiles.includes("readiness-gate.json"),
      migrationPlanAvailable: sourceFiles.includes("migration-plan.md"),
      assessmentReportAvailable: sourceFiles.includes("assessment-report.md")
    }
  });

  files.push({
    path: "client-pack.json",
    content: `${stableStringify(pack)}\n`
  });

  return {
    pack,
    files: sortByStableKey(files, (entry) => entry.path)
  };
};

