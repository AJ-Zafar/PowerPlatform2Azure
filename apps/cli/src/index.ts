#!/usr/bin/env node
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  serializeDeterministicIR,
  stableStringify,
  validatePowerPlatformIR
} from "@power-exit/ir";
import {
  createDefaultReadinessGatePolicyFile,
  assessPowerPlatformIR,
  evaluateReadinessGate,
  generateAssessmentReportMarkdown,
  readinessGatePolicyFileSchema,
  renderReadinessGatePolicyMarkdown,
  renderReadinessGateMarkdown,
  serializeReadinessGate,
  type ReadinessGatePolicyProfile,
  type ReadinessGateManualReviewItem,
  type ReadinessGateThresholds,
  type ReadinessGateUnresolvedDependency,
  type MigrationAssessment
} from "@power-exit/assessment";
import {
  generationPlanSchema,
  generateAzureInfraFromPowerPlatformIR,
  generateAzureFunctionsFromPowerPlatformIR,
  generateCanvasReactFromPowerPlatformIR,
  generateDataverseSqlFromPowerPlatformIR,
  hasGeneratedFileMarker,
  planGeneration,
  renderGenerationPlanMarkdown,
  serializeGenerationPlan,
  type FunctionsGenerationPlanDetails,
  type GeneratedArtifact,
  type GenerationUnsupportedFeature,
  type GenerationWarning,
  type InfraGenerationPlanDetails,
  type ExistingFileState,
  type GenerationManualReviewItem,
  type GenerationPlan
} from "@power-exit/generators";
import { analyseSolutionFolder } from "@power-exit/parsers";

type WriteFn = (line: string) => void;

class CliError extends Error {
  public readonly code: string;

  public readonly details?: Record<string, string>;

  public constructor(
    code: string,
    message: string,
    details?: Record<string, string>
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface AnalyseArgs {
  solutionFolder: string;
  outputFolder: string;
  includeReport: boolean;
}

interface ReportArgs {
  irFilePath: string;
  outputFolder: string;
}

interface GenerateSqlArgs {
  irFilePath: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
}

interface GenerateReactArgs {
  irFilePath: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
}

interface GenerateFunctionsArgs {
  irFilePath: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
}

interface GenerateInfraArgs {
  irFilePath: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
}

interface MigrateArgs {
  solutionFolder: string;
  outputFolder: string;
  dryRun: boolean;
  force: boolean;
  clean: boolean;
  gate: GateModeArgs;
}

interface GateModeArgs {
  enabled: boolean;
  ci: boolean;
  strict: boolean;
  policyFilePath?: string;
  profileName?: string;
  thresholds: Partial<ReadinessGateThresholds>;
}

interface GateArgs {
  outputFolder: string;
  ci: boolean;
  strict: boolean;
  policyFilePath?: string;
  profileName?: string;
  thresholds: Partial<ReadinessGateThresholds>;
}

interface InitPolicyArgs {
  outputFolder: string;
}

const parseAnalyseArgs = (args: string[]): AnalyseArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit analyse <solution-folder> --out <output-folder>"
    );
  }

  const [solutionFolder, ...flags] = args;
  let outputFolder: string | undefined;
  let includeReport = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--report") {
      includeReport = true;
      continue;
    }

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    solutionFolder: path.resolve(solutionFolder),
    outputFolder: path.resolve(outputFolder),
    includeReport
  };
};

const parseReportArgs = (args: string[]): ReportArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit report <ir-json> --out <output-folder>"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder)
  };
};

const parseGenerateSqlArgs = (args: string[]): GenerateSqlArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit generate sql <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean
  };
};

const parseGenerateReactArgs = (args: string[]): GenerateReactArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit generate react <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean
  };
};

const parseGenerateFunctionsArgs = (args: string[]): GenerateFunctionsArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit generate functions <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean
  };
};

const parseGenerateInfraArgs = (args: string[]): GenerateInfraArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit generate infra <ir-json> --out <output-folder> [--dry-run] [--force] [--clean]"
    );
  }

  const [irFilePath, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    irFilePath: path.resolve(irFilePath),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean
  };
};

const parseNumericFlag = (input: {
  flags: string[];
  index: number;
  flagName: string;
  min: number;
  max: number;
  integer?: boolean;
}): { value: number; nextIndex: number } => {
  const rawValue = input.flags[input.index + 1];
  if (rawValue === undefined) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      `Missing value for ${input.flagName}.`
    );
  }

  const parsedValue = Number(rawValue);
  const isValidNumber =
    Number.isFinite(parsedValue) &&
    (!input.integer || Number.isInteger(parsedValue)) &&
    parsedValue >= input.min &&
    parsedValue <= input.max;
  if (!isValidNumber) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      `Invalid value for ${input.flagName}. Expected ${
        input.integer ? "an integer" : "a number"
      } between ${input.min} and ${input.max}.`
    );
  }

  return {
    value: parsedValue,
    nextIndex: input.index + 1
  };
};

const parseGateArgs = (args: string[]): GateArgs => {
  if (args.length < 1) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit gate <output-folder> [--ci] [--strict] [--policy <policy-file>] [--profile <profile-name>] [--max-risk <number>] [--max-complexity <number>] [--min-confidence <number>] [--max-unresolved <number>] [--allow-critical-unsupported]"
    );
  }

  const [outputFolder, ...flags] = args;
  let ci = false;
  let strict = false;
  let policyFilePath: string | undefined;
  let profileName: string | undefined;
  const thresholds: Partial<ReadinessGateThresholds> = {};

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--ci") {
      ci = true;
      continue;
    }

    if (flag === "--strict") {
      strict = true;
      continue;
    }

    if (flag === "--allow-critical-unsupported") {
      thresholds.allowCriticalUnsupported = true;
      continue;
    }

    if (flag === "--policy") {
      const candidate = flags[index + 1];
      if (candidate === undefined) {
        throw new CliError("INVALID_ARGUMENTS", "Missing value for --policy.");
      }
      policyFilePath = path.resolve(candidate);
      index += 1;
      continue;
    }

    if (flag === "--profile") {
      const candidate = flags[index + 1];
      if (candidate === undefined) {
        throw new CliError("INVALID_ARGUMENTS", "Missing value for --profile.");
      }
      profileName = candidate;
      index += 1;
      continue;
    }

    if (flag === "--max-risk") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--max-risk",
        min: 0,
        max: 100,
        integer: true
      });
      thresholds.maxRiskScore = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (flag === "--max-complexity") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--max-complexity",
        min: 0,
        max: 100,
        integer: true
      });
      thresholds.maxComplexityScore = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (flag === "--min-confidence") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--min-confidence",
        min: 0,
        max: 1
      });
      thresholds.minConfidence = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (flag === "--max-unresolved") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--max-unresolved",
        min: 0,
        max: 5000,
        integer: true
      });
      thresholds.maxUnresolvedDependencies = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (profileName !== undefined && policyFilePath === undefined) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "--profile requires --policy <policy-file>."
    );
  }

  return {
    outputFolder: path.resolve(outputFolder),
    ci,
    strict,
    policyFilePath,
    profileName,
    thresholds
  };
};

const parseMigrateArgs = (args: string[]): MigrateArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit migrate <solution-folder> --out <output-folder> [--dry-run] [--force] [--clean] [--gate] [--strict] [--policy <policy-file>] [--profile <profile-name>] [--max-risk <number>] [--max-complexity <number>] [--min-confidence <number>] [--max-unresolved <number>] [--allow-critical-unsupported]"
    );
  }

  const [solutionFolder, ...flags] = args;
  let outputFolder: string | undefined;
  let dryRun = false;
  let force = false;
  let clean = false;
  let gateEnabled = false;
  let gateStrict = false;
  let gatePolicyFilePath: string | undefined;
  let gateProfileName: string | undefined;
  const gateThresholds: Partial<ReadinessGateThresholds> = {};

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--out") {
      outputFolder = flags[index + 1];
      index += 1;
      continue;
    }

    if (flag === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (flag === "--force") {
      force = true;
      continue;
    }

    if (flag === "--clean") {
      clean = true;
      continue;
    }

    if (flag === "--gate") {
      gateEnabled = true;
      continue;
    }

    if (flag === "--strict") {
      gateEnabled = true;
      gateStrict = true;
      continue;
    }

    if (flag === "--allow-critical-unsupported") {
      gateEnabled = true;
      gateThresholds.allowCriticalUnsupported = true;
      continue;
    }

    if (flag === "--policy") {
      const candidate = flags[index + 1];
      if (candidate === undefined) {
        throw new CliError("INVALID_ARGUMENTS", "Missing value for --policy.");
      }
      gateEnabled = true;
      gatePolicyFilePath = path.resolve(candidate);
      index += 1;
      continue;
    }

    if (flag === "--profile") {
      const candidate = flags[index + 1];
      if (candidate === undefined) {
        throw new CliError("INVALID_ARGUMENTS", "Missing value for --profile.");
      }
      gateEnabled = true;
      gateProfileName = candidate;
      index += 1;
      continue;
    }

    if (flag === "--max-risk") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--max-risk",
        min: 0,
        max: 100,
        integer: true
      });
      gateEnabled = true;
      gateThresholds.maxRiskScore = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (flag === "--max-complexity") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--max-complexity",
        min: 0,
        max: 100,
        integer: true
      });
      gateEnabled = true;
      gateThresholds.maxComplexityScore = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (flag === "--min-confidence") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--min-confidence",
        min: 0,
        max: 1
      });
      gateEnabled = true;
      gateThresholds.minConfidence = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (flag === "--max-unresolved") {
      const parsed = parseNumericFlag({
        flags,
        index,
        flagName: "--max-unresolved",
        min: 0,
        max: 5000,
        integer: true
      });
      gateEnabled = true;
      gateThresholds.maxUnresolvedDependencies = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (gateProfileName !== undefined && gatePolicyFilePath === undefined) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "--profile requires --policy <policy-file>."
    );
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    solutionFolder: path.resolve(solutionFolder),
    outputFolder: path.resolve(outputFolder),
    dryRun,
    force,
    clean,
    gate: {
      enabled: gateEnabled,
      ci: false,
      strict: gateStrict,
      policyFilePath: gatePolicyFilePath,
      profileName: gateProfileName,
      thresholds: gateThresholds
    }
  };
};

const parseInitPolicyArgs = (args: string[]): InitPolicyArgs => {
  if (args.length < 2) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit init-policy --out <output-folder>"
    );
  }

  let outputFolder: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--out") {
      outputFolder = args[index + 1];
      index += 1;
      continue;
    }

    throw new CliError("INVALID_ARGUMENTS", `Unknown argument "${flag ?? ""}".`);
  }

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  return {
    outputFolder: path.resolve(outputFolder)
  };
};

const ensureInputFolder = async (solutionFolder: string): Promise<void> => {
  let metadata;

  try {
    metadata = await stat(solutionFolder);
  } catch {
    throw new CliError("INPUT_FOLDER_NOT_FOUND", "Solution folder does not exist.", {
      solutionFolder
    });
  }

  if (!metadata.isDirectory()) {
    throw new CliError("INPUT_FOLDER_NOT_FOUND", "Solution path is not a folder.", {
      solutionFolder
    });
  }
};

const ensureInputFile = async (inputFilePath: string): Promise<void> => {
  let metadata;

  try {
    metadata = await stat(inputFilePath);
  } catch {
    throw new CliError("INPUT_FILE_NOT_FOUND", "Input file does not exist.", {
      inputFilePath
    });
  }

  if (!metadata.isFile()) {
    throw new CliError("INPUT_FILE_NOT_FOUND", "Input path is not a file.", {
      inputFilePath
    });
  }
};

const ensureOutputFolder = async (outputFolder: string): Promise<void> => {
  try {
    await mkdir(outputFolder, { recursive: true });
    const metadata = await stat(outputFolder);

    if (!metadata.isDirectory()) {
      throw new CliError(
        "INVALID_OUTPUT_PATH",
        "Output path exists and is not a folder.",
        {
          outputFolder
        }
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError("INVALID_OUTPUT_PATH", "Could not create output folder.", {
      outputFolder
    });
  }
};

const cleanGeneratedFiles = async (targetFolder: string): Promise<void> => {
  let entries;
  try {
    entries = await readdir(targetFolder, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(targetFolder, entry.name);
    if (entry.isDirectory()) {
      await cleanGeneratedFiles(entryPath);
      try {
        await rmdir(entryPath);
      } catch {
        // Keep non-empty directories.
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    try {
      const content = await readFile(entryPath, "utf-8");
      if (hasGeneratedFileMarker(content)) {
        await unlink(entryPath);
      }
    } catch {
      // Non-text files and read/delete errors are intentionally ignored in clean mode.
    }
  }
};

const loadExistingFiles = async (
  outputFolder: string,
  artifactPaths: string[]
): Promise<ExistingFileState[]> => {
  const existingFiles: ExistingFileState[] = [];

  for (const artifactPath of artifactPaths) {
    const absolutePath = path.join(outputFolder, artifactPath);
    try {
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) {
        continue;
      }
      existingFiles.push({
        path: artifactPath,
        content: await readFile(absolutePath, "utf-8")
      });
    } catch {
      // Missing files are expected and excluded from existing snapshot.
    }
  }

  return existingFiles;
};

const writePlannedArtifacts = async (
  outputFolder: string,
  writes: Array<{ path: string; content: string }>
): Promise<void> => {
  for (const writeEntry of writes) {
    const outputPath = path.join(outputFolder, writeEntry.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, writeEntry.content, "utf-8");
  }
};

const writeGenerationPlanFiles = async (
  outputFolder: string,
  jsonContent: string,
  markdownContent: string
): Promise<void> => {
  await writeFile(path.join(outputFolder, "generation-plan.json"), jsonContent, "utf-8");
  await writeFile(path.join(outputFolder, "generation-plan.md"), markdownContent, "utf-8");
};

const warningSeverityToReviewSeverity = (
  warningCode: string
): GenerationManualReviewItem["severity"] =>
  warningCode.includes("UNSUPPORTED") || warningCode.includes("COMPLEXITY")
    ? "medium"
    : "low";

const buildManualReviewItems = (input: {
  warnings: Array<{ code: string; message: string; sourceArtifactIds: string[] }>;
  unsupportedFeatures: Array<{
    featureType: string;
    reason: string;
    severity: GenerationManualReviewItem["severity"];
    sourceArtifactIds: string[];
  }>;
  formulaHotspots?: Array<{
    generatedStubName: string;
    recommendation: string;
    severity: GenerationManualReviewItem["severity"];
    screen: string;
    control: string | null;
    property: string;
  }>;
  functionsPlan?: {
    manualReviewHotspots: Array<{ message: string; severity: GenerationManualReviewItem["severity"] }>;
    unsupportedActions: Array<{ flowName: string; actionName: string; actionType: string }>;
    unresolvedDependencies: Array<{ referenceType: string; referenceName: string }>;
    unresolvedAdapterRequirements: Array<{ connectorKey: string; requirement: string }>;
    deploymentReadiness: {
      scaffoldOnly: boolean;
      needsConfig: boolean;
      needsManualLogic: boolean;
      blocked: boolean;
    };
  };
  infraPlan?: {
    securityManualReviewItems: string[];
    unresolvedConfigurationItems: string[];
    deploymentReadiness: {
      scaffoldOnly: boolean;
      needsConfig: boolean;
      needsSecurityReview: boolean;
      blocked: boolean;
    };
  };
}): GenerationManualReviewItem[] => {
  const reviewItems: GenerationManualReviewItem[] = [];

  input.warnings.forEach((warning) => {
    reviewItems.push({
      id: `review:warning:${warning.code}:${warning.message}`,
      category: "warning",
      severity: warningSeverityToReviewSeverity(warning.code),
      message: warning.message,
      relatedPaths: [],
      sourceArtifactIds: warning.sourceArtifactIds
    });
  });

  input.unsupportedFeatures.forEach((feature) => {
    reviewItems.push({
      id: `review:unsupported:${feature.featureType}:${feature.reason}`,
      category: "unsupported-feature",
      severity: feature.severity,
      message: feature.reason,
      relatedPaths: [],
      sourceArtifactIds: feature.sourceArtifactIds
    });
  });

  (input.formulaHotspots ?? []).forEach((hotspot) => {
    reviewItems.push({
      id: `review:formula-hotspot:${hotspot.generatedStubName}`,
      category: "formula-hotspot",
      severity: hotspot.severity,
      message: hotspot.recommendation,
      relatedPaths: [
        `${hotspot.screen}:${hotspot.control ?? "(screen)"}:${hotspot.property}`
      ],
      sourceArtifactIds: []
    });
  });

  input.functionsPlan?.manualReviewHotspots.forEach((hotspot, index) => {
    reviewItems.push({
      id: `review:function-hotspot:${index}:${hotspot.message}`,
      category: "functions-hotspot",
      severity: hotspot.severity,
      message: hotspot.message,
      relatedPaths: [],
      sourceArtifactIds: []
    });
  });

  input.functionsPlan?.unsupportedActions.forEach((unsupportedAction) => {
    reviewItems.push({
      id: `review:function-unsupported-action:${unsupportedAction.flowName}:${unsupportedAction.actionName}:${unsupportedAction.actionType}`,
      category: "functions-unsupported-action",
      severity: "medium",
      message: `Unsupported action ${unsupportedAction.flowName}.${unsupportedAction.actionName} (${unsupportedAction.actionType}).`,
      relatedPaths: [],
      sourceArtifactIds: []
    });
  });

  input.functionsPlan?.unresolvedDependencies.forEach((dependency) => {
    reviewItems.push({
      id: `review:function-unresolved:${dependency.referenceType}:${dependency.referenceName}`,
      category: "functions-unresolved-dependency",
      severity: "high",
      message: `Unresolved dependency ${dependency.referenceType}:${dependency.referenceName}.`,
      relatedPaths: [],
      sourceArtifactIds: []
    });
  });

  input.functionsPlan?.unresolvedAdapterRequirements.forEach((requirement) => {
    reviewItems.push({
      id: `review:function-adapter-requirement:${requirement.connectorKey}:${requirement.requirement}`,
      category: "functions-adapter-requirement",
      severity: "high",
      message: `${requirement.connectorKey}: ${requirement.requirement}`,
      relatedPaths: [],
      sourceArtifactIds: []
    });
  });

  if (input.functionsPlan?.deploymentReadiness.blocked) {
    reviewItems.push({
      id: "review:function-deployment-readiness:blocked",
      category: "functions-deployment-readiness",
      severity: "high",
      message:
        "Functions scaffold is blocked for deployment readiness and requires manual trigger/adapter implementation.",
      relatedPaths: [],
      sourceArtifactIds: []
    });
  }

  input.infraPlan?.securityManualReviewItems.forEach((item, index) => {
    reviewItems.push({
      id: `review:infra-security:${index}:${item}`,
      category: "infra-security-review",
      severity: "high",
      message: item,
      relatedPaths: [],
      sourceArtifactIds: []
    });
  });

  input.infraPlan?.unresolvedConfigurationItems.forEach((item, index) => {
    reviewItems.push({
      id: `review:infra-unresolved-config:${index}:${item}`,
      category: "infra-unresolved-config",
      severity: "medium",
      message: item,
      relatedPaths: [],
      sourceArtifactIds: []
    });
  });

  if (input.infraPlan?.deploymentReadiness.blocked) {
    reviewItems.push({
      id: "review:infra-deployment-readiness:blocked",
      category: "infra-deployment-readiness",
      severity: "high",
      message:
        "Infra scaffold is blocked for deployment readiness due to missing solution metadata placeholders.",
      relatedPaths: [],
      sourceArtifactIds: []
    });
  }

  return reviewItems;
};

const withOutputPrefix = (
  artifacts: GeneratedArtifact[],
  prefix: string
): GeneratedArtifact[] =>
  artifacts.map((artifact) => ({
    ...artifact,
    artifactId: `${artifact.artifactId}:${prefix}`,
    filePath: `${prefix}/${artifact.filePath}`.replace(/\/+/g, "/")
  }));

const withPrefixedFunctionsPlan = (
  functionsPlan: FunctionsGenerationPlanDetails,
  prefix: string
): FunctionsGenerationPlanDetails => ({
  ...functionsPlan,
  plannedAdapterFiles: functionsPlan.plannedAdapterFiles.map((adapterFile) => ({
    ...adapterFile,
    filePath: `${prefix}/${adapterFile.filePath}`.replace(/\/+/g, "/")
  })),
  connectorAdapterMappings: functionsPlan.connectorAdapterMappings.map((mapping) => ({
    ...mapping,
    adapterFilePath: `${prefix}/${mapping.adapterFilePath}`.replace(/\/+/g, "/")
  }))
});

const withPrefixedInfraPlan = (
  infraPlan: InfraGenerationPlanDetails,
  prefix: string
): InfraGenerationPlanDetails => ({
  ...infraPlan,
  environmentParameterFiles: infraPlan.environmentParameterFiles.map((filePath) =>
    filePath.startsWith(`${prefix}/`) ? filePath : `${prefix}/${filePath}`.replace(/\/+/g, "/")
  ),
  plannedModules: infraPlan.plannedModules.map((modulePath) =>
    modulePath.startsWith(`${prefix}/`)
      ? modulePath
      : `${prefix}/${modulePath}`.replace(/\/+/g, "/")
  ),
  contentHashes: infraPlan.contentHashes.map((entry) => ({
    ...entry,
    path: entry.path.startsWith(`${prefix}/`)
      ? entry.path
      : `${prefix}/${entry.path}`.replace(/\/+/g, "/")
  }))
});

const isReportLikeArtifactType = (artifactType: string): boolean =>
  ["ir-json", "json-report", "markdown-report", "markdown-readme", "markdown-notes"].includes(
    artifactType
  );

const renderMasterMigrationPlanMarkdown = (input: {
  solutionFolder: string;
  ir: ReturnType<typeof validatePowerPlatformIR>;
  assessment: MigrationAssessment;
  planSummary: {
    totalPlannedFiles: number;
    creates: number;
    overwrites: number;
    skips: number;
    unchanged: number;
    warnings: number;
    unsupportedFeatures: number;
    manualReviewItems: number;
  };
  generatedOutputs: Array<{ label: string; value: string }>;
  manualReviewItems: GenerationManualReviewItem[];
}): string => {
  const lines: string[] = [];
  lines.push("# Power Exit Master Migration Plan");
  lines.push("");
  lines.push("## Executive summary");
  lines.push("");
  lines.push(
    `- Overall readiness: ${input.assessment.overallReadiness} (risk ${input.assessment.overallRiskScore}, complexity ${input.assessment.overallComplexityScore}, confidence ${input.assessment.overallConfidence.toFixed(2)}).`
  );
  lines.push(`- Planned generated files: ${input.planSummary.totalPlannedFiles}.`);
  lines.push(
    `- Plan actions: create=${input.planSummary.creates}, overwrite=${input.planSummary.overwrites}, skip=${input.planSummary.skips}, unchanged=${input.planSummary.unchanged}.`
  );
  lines.push("");
  lines.push("## Solution metadata");
  lines.push("");
  lines.push(`- Solution name: ${input.ir.solution.name}`);
  lines.push(`- Solution unique name: ${input.ir.solution.uniqueName}`);
  lines.push(`- Solution version: ${input.ir.solution.version}`);
  lines.push(`- Solution folder: ${input.solutionFolder}`);
  lines.push(`- Publisher: ${input.ir.solution.publisher.displayName}`);
  lines.push("");
  lines.push("## Readiness/risk/complexity summary");
  lines.push("");
  lines.push(`- Overall readiness: ${input.assessment.overallReadiness}`);
  lines.push(`- Overall risk score: ${input.assessment.overallRiskScore}`);
  lines.push(`- Overall complexity score: ${input.assessment.overallComplexityScore}`);
  lines.push(`- Overall confidence: ${input.assessment.overallConfidence.toFixed(2)}`);
  lines.push("");
  lines.push("## Generated outputs");
  lines.push("");
  input.generatedOutputs.forEach((entry) => lines.push(`- ${entry.label}: ${entry.value}`));
  lines.push("");
  lines.push("## Manual review hotspots");
  lines.push("");
  if (input.manualReviewItems.length === 0) {
    lines.push("- None.");
  } else {
    input.manualReviewItems
      .slice(0, 25)
      .forEach((item) => lines.push(`- [${item.severity}] ${item.category}: ${item.message}`));
  }
  lines.push("");
  lines.push("## Unsupported features");
  lines.push("");
  if (input.ir.unsupportedFeatures.length === 0) {
    lines.push("- None.");
  } else {
    input.ir.unsupportedFeatures
      .slice(0, 30)
      .forEach((feature) =>
        lines.push(`- [${feature.severity}] ${feature.featureType}: ${feature.reason}`)
      );
  }
  lines.push("");
  lines.push("## Security considerations");
  lines.push("");
  lines.push("- Enforce least-privilege RBAC for generated managed identities.");
  lines.push("- Move sensitive settings to Key Vault references and avoid embedded secrets.");
  lines.push("- Configure private endpoints/network segmentation before production rollout.");
  lines.push("- Validate Entra ID auth and SQL firewall/network policies.");
  lines.push("");
  lines.push("## Recommended migration waves");
  lines.push("");
  input.assessment.migrationWaves.forEach((wave) =>
    lines.push(`- ${wave.waveId}: ${wave.title} — ${wave.description}`)
  );
  lines.push("");
  lines.push("## Next engineering tasks");
  lines.push("");
  lines.push(
    "- Resolve skipped/conflicting files and re-run migrate with --force only when overwrite intent is explicit."
  );
  lines.push("- Address high/critical manual review hotspots before implementation sprints.");
  lines.push("- Convert scaffolded React/Functions/Infra TODOs into production-ready implementations.");
  lines.push("- Re-run deterministic validation harness after each major migration conversion pass.");

  return `${lines.join("\n")}\n`;
};

const loadJsonFileIfPresent = async (filePath: string): Promise<unknown | undefined> => {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      return undefined;
    }

    return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
};

const resolveGatePolicyProfile = async (input: {
  policyFilePath?: string;
  profileName?: string;
}): Promise<{
  policyProfile: ReadinessGatePolicyProfile | null;
  sourcePolicyFile?: string;
}> => {
  if (input.policyFilePath === undefined) {
    return {
      policyProfile: null
    };
  }

  await ensureInputFile(input.policyFilePath);
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(input.policyFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("GATE_POLICY_INVALID_JSON", "Gate policy is not valid JSON.", {
      policyFilePath: input.policyFilePath
    });
  }

  let policyFile;
  try {
    policyFile = readinessGatePolicyFileSchema.parse(payload);
  } catch {
    throw new CliError(
      "GATE_POLICY_VALIDATION_FAILURE",
      "Gate policy file failed schema validation.",
      {
        policyFilePath: input.policyFilePath
      }
    );
  }

  const selectedProfileName = input.profileName ?? "dev";
  const selectedProfile = policyFile.profiles.find(
    (profile) => profile.profileName === selectedProfileName
  );
  if (selectedProfile === undefined) {
    throw new CliError(
      "GATE_POLICY_PROFILE_NOT_FOUND",
      `Gate policy profile "${selectedProfileName}" was not found.`,
      {
        policyFilePath: input.policyFilePath,
        profileName: selectedProfileName
      }
    );
  }

  return {
    policyProfile: selectedProfile,
    sourcePolicyFile: input.policyFilePath
  };
};

const toReadinessGateManualReviewItems = (
  generationPlan: GenerationPlan | null
): ReadinessGateManualReviewItem[] =>
  generationPlan
    ? generationPlan.manualReviewItems.map((item) => ({
        id: item.id,
        category: item.category,
        severity: item.severity,
        message: item.message,
        relatedPaths: item.relatedPaths
      }))
    : [];

const toReadinessGateUnresolvedDependencies = (input: {
  generationPlan: GenerationPlan | null;
  ir: ReturnType<typeof validatePowerPlatformIR>;
}): ReadinessGateUnresolvedDependency[] => {
  const unresolved: ReadinessGateUnresolvedDependency[] = [];
  if (input.ir.analysisSummary.unresolvedDependencies > 0) {
    unresolved.push({
      id: "ir:analysis-summary:unresolved-dependencies",
      referenceType: "analysis-summary",
      referenceName: "unresolvedDependencies",
      message: `IR analysis summary reports ${input.ir.analysisSummary.unresolvedDependencies} unresolved dependencies.`,
      severity: input.ir.analysisSummary.unresolvedDependencies > 5 ? "high" : "medium"
    });
  }

  if (!input.generationPlan?.functionsPlan) {
    return unresolved;
  }

  input.generationPlan.functionsPlan.unresolvedDependencies.forEach((dependency, index) => {
    unresolved.push({
      id: `functions:unresolved:${index}:${dependency.referenceType}:${dependency.referenceName}`,
      referenceType: dependency.referenceType,
      referenceName: dependency.referenceName,
      message: `Functions unresolved dependency ${dependency.referenceType}:${dependency.referenceName}.`,
      severity: "high"
    });
  });
  input.generationPlan.functionsPlan.unresolvedAdapterRequirements.forEach((requirement, index) => {
    unresolved.push({
      id: `functions:adapter-requirement:${index}:${requirement.connectorKey}`,
      referenceType: "adapter-requirement",
      referenceName: requirement.connectorKey,
      message: requirement.requirement,
      severity: "high"
    });
  });

  return unresolved;
};

const toReadinessGateGeneratorReadiness = (
  generationPlan: GenerationPlan | null
): {
  functionsBlocked: boolean;
  infraBlocked: boolean;
  functionsNeedsConfig: boolean;
  infraNeedsConfig: boolean;
  functionsNeedsManualLogic: boolean;
  infraNeedsSecurityReview: boolean;
} => ({
  functionsBlocked: generationPlan?.functionsPlan?.deploymentReadiness.blocked ?? false,
  infraBlocked: generationPlan?.infraPlan?.deploymentReadiness.blocked ?? false,
  functionsNeedsConfig: generationPlan?.functionsPlan?.deploymentReadiness.needsConfig ?? false,
  infraNeedsConfig: generationPlan?.infraPlan?.deploymentReadiness.needsConfig ?? false,
  functionsNeedsManualLogic:
    generationPlan?.functionsPlan?.deploymentReadiness.needsManualLogic ?? false,
  infraNeedsSecurityReview:
    generationPlan?.infraPlan?.deploymentReadiness.needsSecurityReview ?? false
});

const resolveGateCiExitCode = (input: {
  status: "pass" | "warn" | "fail";
  strict: boolean;
}): number => {
  if (input.status === "fail") {
    return 1;
  }

  if (input.status === "warn" && input.strict) {
    return 1;
  }

  return 0;
};

const buildReadinessGateEvaluation = (input: {
  ir: ReturnType<typeof validatePowerPlatformIR>;
  assessment: MigrationAssessment;
  generationPlan: GenerationPlan | null;
  policyProfile: ReadinessGatePolicyProfile | null;
  sourcePolicyFile?: string;
  thresholds: Partial<ReadinessGateThresholds>;
}): {
  gate: ReturnType<typeof evaluateReadinessGate>;
  markdown: string;
  json: string;
  generationPlanAvailable: boolean;
} => {
  const manualReviewItems = toReadinessGateManualReviewItems(input.generationPlan);
  if (!input.generationPlan) {
    manualReviewItems.push({
      id: "gate:generation-plan-missing",
      category: "generation-plan",
      severity: "high",
      message:
        "generation-plan.json was not found; gate evaluated with partial inputs (IR + assessment only).",
      relatedPaths: ["generation-plan.json"]
    });
  }
  const gate = evaluateReadinessGate({
    ir: input.ir,
    assessment: input.assessment,
    policy: input.policyProfile,
    sourcePolicyFile: input.sourcePolicyFile,
    thresholds: input.thresholds,
    manualReviewItems,
    unresolvedDependencies: toReadinessGateUnresolvedDependencies({
      generationPlan: input.generationPlan,
      ir: input.ir
    }),
    generatorReadiness: toReadinessGateGeneratorReadiness(input.generationPlan)
  });

  return {
    gate,
    markdown: renderReadinessGateMarkdown(gate),
    json: serializeReadinessGate(gate),
    generationPlanAvailable: input.generationPlan !== null
  };
};

const executeAnalyse = async (
  args: string[],
  stdout: WriteFn
): Promise<void> => {
  const parsedArgs = parseAnalyseArgs(args);

  await ensureInputFolder(parsedArgs.solutionFolder);
  await ensureOutputFolder(parsedArgs.outputFolder);
  const analysis = await analyseSolutionFolder(parsedArgs.solutionFolder);
  let validatedIr;

  try {
    validatedIr = validatePowerPlatformIR(analysis.ir);
  } catch {
    throw new CliError(
      "IR_VALIDATION_FAILURE",
      "Generated IR failed schema validation."
    );
  }

  const serializedIr = `${serializeDeterministicIR(validatedIr)}\n`;
  const outputFile = path.join(parsedArgs.outputFolder, "ir.json");
  const reportFile = path.join(parsedArgs.outputFolder, "assessment-report.md");

  await writeFile(outputFile, serializedIr, "utf-8");

  if (parsedArgs.includeReport) {
    const assessment = assessPowerPlatformIR(validatedIr);
    const report = generateAssessmentReportMarkdown(validatedIr, assessment);
    await writeFile(reportFile, `${report}\n`, "utf-8");
  }

  stdout(
    JSON.stringify({
      command: "analyse",
      status: "success",
      solutionFolder: parsedArgs.solutionFolder,
      outputFile,
      filesScanned: analysis.summary.filesScanned,
      classifiedFiles: analysis.summary.classifiedFiles,
      unknownFiles: analysis.summary.unknownFiles,
      solutionMetadataFound: analysis.summary.solutionMetadataFound,
      entitiesParsed: analysis.summary.entitiesParsed,
      attributesParsed: analysis.summary.attributesParsed,
      relationshipsParsed: analysis.summary.relationshipsParsed,
      choicesParsed: analysis.summary.choicesParsed,
      canvasAppsParsed: analysis.summary.canvasAppsParsed,
      canvasScreensParsed: analysis.summary.canvasScreensParsed,
      canvasControlsParsed: analysis.summary.canvasControlsParsed,
      canvasFormulasParsed: analysis.summary.canvasFormulasParsed,
      canvasScreensByReadiness: analysis.summary.canvasScreensByReadiness,
      canvasControlsByRole: analysis.summary.canvasControlsByRole,
      canvasBlockedControls: analysis.summary.canvasBlockedControls,
      canvasUnknownControls: analysis.summary.canvasUnknownControls,
      canvasComplexFormulas: analysis.summary.canvasComplexFormulas,
      canvasLayoutWarnings: analysis.summary.canvasLayoutWarnings,
      flowsParsed: analysis.summary.flowsParsed,
      triggersParsed: analysis.summary.triggersParsed,
      actionsParsed: analysis.summary.actionsParsed,
      connectorsDetected: analysis.summary.connectorsDetected,
      premiumCustomConnectors: analysis.summary.premiumCustomConnectors,
      flowsByReadiness: analysis.summary.flowsByReadiness,
      unsupportedFlowFeatures: analysis.summary.unsupportedFlowFeatures,
      unresolvedFlowDependencies: analysis.summary.unresolvedFlowDependencies,
      environmentVariables: analysis.summary.environmentVariables,
      connectionReferences: analysis.summary.connectionReferences,
      securityRoles: analysis.summary.securityRoles,
      warnings: validatedIr.warnings.length,
      unsupportedFeatures: validatedIr.unsupportedFeatures.length,
      unsupported: validatedIr.unsupportedFeatures.length,
      unresolvedDependencies: analysis.summary.unresolvedDependencies,
      confidence: validatedIr.confidence,
      reportGenerated: parsedArgs.includeReport,
      reportFile: parsedArgs.includeReport ? reportFile : undefined
    })
  );
};

const executeReport = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseReportArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const assessment = assessPowerPlatformIR(validatedIr);
  const report = generateAssessmentReportMarkdown(validatedIr, assessment);
  const reportFile = path.join(parsedArgs.outputFolder, "assessment-report.md");
  await writeFile(reportFile, `${report}\n`, "utf-8");

  stdout(
    JSON.stringify({
      command: "report",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFile: reportFile,
      overallReadiness: assessment.overallReadiness,
      overallRiskScore: assessment.overallRiskScore,
      overallComplexityScore: assessment.overallComplexityScore,
      overallConfidence: assessment.overallConfidence
    })
  );
};

const executeGenerateSql = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseGenerateSqlArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const generation = await generateDataverseSqlFromPowerPlatformIR(validatedIr, {
    invocationProvenance: {
      sourcePath: parsedArgs.irFilePath,
      sourceType: "cli"
    },
    outputFolder: parsedArgs.outputFolder
  });

  const artifactPaths = generation.artifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(
    parsedArgs.outputFolder,
    artifactPaths
  );
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }
  const manualReviewItems = buildManualReviewItems({
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures
  });
  const planned = planGeneration({
    artifacts: generation.artifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    manualReviewItems,
    sqlPlan: generation.output.sqlPlan
  });
  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  if (!parsedArgs.dryRun) {
    await writePlannedArtifacts(parsedArgs.outputFolder, planned.writes);
  }

  stdout(
    JSON.stringify({
      command: "generate-sql",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFolder: parsedArgs.outputFolder,
      tablesGenerated: generation.output.tablesGenerated,
      columnsGenerated: generation.output.columnsGenerated,
      relationshipsGenerated: generation.output.relationshipsGenerated,
      warnings: planned.plan.summary.warnings,
      unsupportedFeatures: planned.plan.summary.unsupportedFeatures,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const executeGenerateReact = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseGenerateReactArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const generation = await generateCanvasReactFromPowerPlatformIR(validatedIr, {
    invocationProvenance: {
      sourcePath: parsedArgs.irFilePath,
      sourceType: "cli"
    },
    outputFolder: parsedArgs.outputFolder
  });

  const artifactPaths = generation.artifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(
    parsedArgs.outputFolder,
    artifactPaths
  );
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }
  const manualReviewItems = buildManualReviewItems({
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    formulaHotspots: generation.output.formulaHotspots
  });
  const planned = planGeneration({
    artifacts: generation.artifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    formulaHotspots: generation.output.formulaHotspots,
    manualReviewItems
  });
  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  if (!parsedArgs.dryRun) {
    await writePlannedArtifacts(parsedArgs.outputFolder, planned.writes);
  }

  stdout(
    JSON.stringify({
      command: "generate-react",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFolder: parsedArgs.outputFolder,
      appsGenerated: generation.output.appsGenerated,
      screensGenerated: generation.output.screensGenerated,
      controlsGenerated: generation.output.controlsGenerated,
      formulasPreserved: generation.output.formulasPreserved,
      formulasClassified: generation.output.formulasClassified,
      stubsGenerated: generation.output.stubsGenerated,
      unsupportedFormulas: generation.output.unsupportedFormulas,
      manualConversionHotspots: generation.output.manualConversionHotspots,
      unsupportedControls: generation.output.unsupportedControls,
      warnings: planned.plan.summary.warnings,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const executeGenerateFunctions = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseGenerateFunctionsArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const generation = await generateAzureFunctionsFromPowerPlatformIR(validatedIr, {
    invocationProvenance: {
      sourcePath: parsedArgs.irFilePath,
      sourceType: "cli"
    },
    outputFolder: parsedArgs.outputFolder
  });

  const artifactPaths = generation.artifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }
  const manualReviewItems = buildManualReviewItems({
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    functionsPlan: generation.output.functionsPlan
  });
  const planned = planGeneration({
    artifacts: generation.artifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    manualReviewItems,
    functionsPlan: generation.output.functionsPlan
  });
  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  if (!parsedArgs.dryRun) {
    await writePlannedArtifacts(parsedArgs.outputFolder, planned.writes);
  }

  stdout(
    JSON.stringify({
      command: "generate-functions",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFolder: parsedArgs.outputFolder,
      functionsGenerated: generation.output.functionsGenerated,
      flowFunctionsGenerated: generation.output.flowFunctionsGenerated,
      canvasApiFunctionsGenerated: generation.output.canvasApiFunctionsGenerated,
      warnings: planned.plan.summary.warnings,
      unsupportedFeatures: planned.plan.summary.unsupportedFeatures,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const executeGenerateInfra = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseGenerateInfraArgs(args);

  await ensureInputFile(parsedArgs.irFilePath);
  await ensureOutputFolder(parsedArgs.outputFolder);
  let irPayload: unknown;

  try {
    irPayload = JSON.parse(await readFile(parsedArgs.irFilePath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  let validatedIr;
  try {
    validatedIr = validatePowerPlatformIR(irPayload);
  } catch {
    throw new CliError("IR_VALIDATION_FAILURE", "Input IR failed schema validation.", {
      irFilePath: parsedArgs.irFilePath
    });
  }

  const generation = await generateAzureInfraFromPowerPlatformIR(validatedIr, {
    invocationProvenance: {
      sourcePath: parsedArgs.irFilePath,
      sourceType: "cli"
    },
    outputFolder: parsedArgs.outputFolder
  });

  const artifactPaths = generation.artifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }
  const manualReviewItems = buildManualReviewItems({
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    infraPlan: generation.output.infraPlan
  });
  const planned = planGeneration({
    artifacts: generation.artifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: generation.warnings,
    unsupportedFeatures: generation.unsupportedFeatures,
    manualReviewItems,
    infraPlan: generation.output.infraPlan
  });
  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  if (!parsedArgs.dryRun) {
    await writePlannedArtifacts(parsedArgs.outputFolder, planned.writes);
  }

  stdout(
    JSON.stringify({
      command: "generate-infra",
      status: "success",
      irFilePath: parsedArgs.irFilePath,
      outputFolder: parsedArgs.outputFolder,
      resourcesPlanned: generation.output.resourcesPlanned,
      modulesPlanned: generation.output.modulesPlanned,
      parameterFilesGenerated: generation.output.parameterFilesGenerated,
      warnings: planned.plan.summary.warnings,
      unsupportedFeatures: planned.plan.summary.unsupportedFeatures,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const executeGenerate = async (args: string[], stdout: WriteFn): Promise<void> => {
  const [subcommand, ...subcommandArgs] = args;

  if (subcommand === "sql") {
    await executeGenerateSql(subcommandArgs, stdout);
    return;
  }

  if (subcommand === "react") {
    await executeGenerateReact(subcommandArgs, stdout);
    return;
  }

  if (subcommand === "functions") {
    await executeGenerateFunctions(subcommandArgs, stdout);
    return;
  }

  if (subcommand === "infra") {
    await executeGenerateInfra(subcommandArgs, stdout);
    return;
  }

  throw new CliError(
    "INVALID_COMMAND",
    "Supported generate commands are: sql, react, functions, infra."
  );
};

const executeGate = async (args: string[], stdout: WriteFn): Promise<number> => {
  const parsedArgs = parseGateArgs(args);
  await ensureInputFolder(parsedArgs.outputFolder);
  const irPath = path.join(parsedArgs.outputFolder, "ir.json");
  await ensureInputFile(irPath);

  let irPayload: unknown;
  try {
    irPayload = JSON.parse(await readFile(irPath, "utf-8")) as unknown;
  } catch {
    throw new CliError("INVALID_IR_JSON", "IR input is not valid JSON.", {
      irFilePath: irPath
    });
  }

  const validatedIr = validatePowerPlatformIR(irPayload);
  const assessment = assessPowerPlatformIR(validatedIr);
  const assessmentReportAvailable = await stat(
    path.join(parsedArgs.outputFolder, "assessment-report.md")
  )
    .then((metadata) => metadata.isFile())
    .catch(() => false);
  const generationPlanPath = path.join(parsedArgs.outputFolder, "generation-plan.json");
  const generationPlanPayload = await loadJsonFileIfPresent(generationPlanPath);
  let generationPlan: GenerationPlan | null = null;
  if (generationPlanPayload !== undefined) {
    try {
      generationPlan = generationPlanSchema.parse(generationPlanPayload);
    } catch {
      throw new CliError(
        "GENERATION_PLAN_VALIDATION_FAILURE",
        "generation-plan.json failed schema validation.",
        { generationPlanPath }
      );
    }
  }

  const resolvedPolicy = await resolveGatePolicyProfile({
    policyFilePath: parsedArgs.policyFilePath,
    profileName: parsedArgs.profileName
  });

  const gateEvaluation = buildReadinessGateEvaluation({
    ir: validatedIr,
    assessment,
    generationPlan,
    policyProfile: resolvedPolicy.policyProfile,
    sourcePolicyFile: resolvedPolicy.sourcePolicyFile,
    thresholds: parsedArgs.thresholds
  });
  await writeFile(
    path.join(parsedArgs.outputFolder, "readiness-gate.json"),
    gateEvaluation.json,
    "utf-8"
  );
  await writeFile(
    path.join(parsedArgs.outputFolder, "readiness-gate.md"),
    gateEvaluation.markdown,
    "utf-8"
  );

  const ciExitCode = resolveGateCiExitCode({
    status: gateEvaluation.gate.status,
    strict: parsedArgs.strict
  });
  stdout(
    JSON.stringify({
      command: "gate",
      status: "success",
      outputFolder: parsedArgs.outputFolder,
      gateStatus: gateEvaluation.gate.status,
      ci: parsedArgs.ci,
      strict: parsedArgs.strict,
      ciExitCode,
      assessmentReportAvailable,
      generationPlanAvailable: gateEvaluation.generationPlanAvailable,
      policyUsed: gateEvaluation.gate.policy?.sourcePolicyFile ?? null,
      profileUsed: gateEvaluation.gate.policy?.profileName ?? null,
      thresholds: gateEvaluation.gate.thresholds,
      statusReasons: gateEvaluation.gate.statusReasons
    })
  );

  return parsedArgs.ci ? ciExitCode : 0;
};

const executeInitPolicy = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseInitPolicyArgs(args);
  await ensureOutputFolder(parsedArgs.outputFolder);

  const policyFile = createDefaultReadinessGatePolicyFile();
  const policyJsonPath = path.join(parsedArgs.outputFolder, "power-exit.policy.json");
  const policyMarkdownPath = path.join(parsedArgs.outputFolder, "power-exit.policy.md");
  await writeFile(policyJsonPath, `${stableStringify(policyFile)}\n`, "utf-8");
  await writeFile(
    policyMarkdownPath,
    renderReadinessGatePolicyMarkdown(policyFile),
    "utf-8"
  );

  stdout(
    JSON.stringify({
      command: "init-policy",
      status: "success",
      outputFolder: parsedArgs.outputFolder,
      policyFile: policyJsonPath,
      policyMarkdown: policyMarkdownPath,
      schemaVersion: policyFile.schemaVersion,
      profiles: policyFile.profiles.map((profile) => profile.profileName)
    })
  );
};

const executeMigrate = async (args: string[], stdout: WriteFn): Promise<void> => {
  const parsedArgs = parseMigrateArgs(args);

  await ensureInputFolder(parsedArgs.solutionFolder);
  await ensureOutputFolder(parsedArgs.outputFolder);

  const analysis = await analyseSolutionFolder(parsedArgs.solutionFolder);
  const validatedIr = validatePowerPlatformIR(analysis.ir);
  const assessment = assessPowerPlatformIR(validatedIr);
  const serializedIr = `${serializeDeterministicIR(validatedIr)}\n`;
  const assessmentReport = `${generateAssessmentReportMarkdown(validatedIr, assessment)}\n`;

  const generatorContext = {
    invocationProvenance: {
      sourcePath: parsedArgs.solutionFolder,
      sourceType: "cli" as const
    },
    outputFolder: parsedArgs.outputFolder
  };
  const sqlGeneration = await generateDataverseSqlFromPowerPlatformIR(validatedIr, generatorContext);
  const reactGeneration = await generateCanvasReactFromPowerPlatformIR(validatedIr, generatorContext);
  const functionsGeneration = await generateAzureFunctionsFromPowerPlatformIR(validatedIr, generatorContext);
  const infraGeneration = await generateAzureInfraFromPowerPlatformIR(validatedIr, generatorContext);

  const sqlArtifacts = withOutputPrefix(sqlGeneration.artifacts, "sql");
  const reactArtifacts = withOutputPrefix(reactGeneration.artifacts, "react");
  const functionsArtifacts = withOutputPrefix(functionsGeneration.artifacts, "functions");
  const infraArtifacts = infraGeneration.artifacts;

  const combinedWarnings: GenerationWarning[] = [
    ...sqlGeneration.warnings,
    ...reactGeneration.warnings,
    ...functionsGeneration.warnings,
    ...infraGeneration.warnings
  ];
  const combinedUnsupported: GenerationUnsupportedFeature[] = [
    ...sqlGeneration.unsupportedFeatures,
    ...reactGeneration.unsupportedFeatures,
    ...functionsGeneration.unsupportedFeatures,
    ...infraGeneration.unsupportedFeatures
  ];
  const combinedFunctionsPlan = withPrefixedFunctionsPlan(
    functionsGeneration.output.functionsPlan,
    "functions"
  );
  const combinedInfraPlan = withPrefixedInfraPlan(infraGeneration.output.infraPlan, "infra");
  const manualReviewItems = buildManualReviewItems({
    warnings: combinedWarnings,
    unsupportedFeatures: combinedUnsupported,
    formulaHotspots: reactGeneration.output.formulaHotspots,
    functionsPlan: combinedFunctionsPlan,
    infraPlan: combinedInfraPlan
  });

  if (validatedIr.analysisSummary.unresolvedDependencies > 0) {
    manualReviewItems.push({
      id: "review:migrate-unresolved-dependencies",
      category: "unresolved-dependencies",
      severity: "high",
      message: `Detected ${validatedIr.analysisSummary.unresolvedDependencies} unresolved dependencies in analysis output.`,
      relatedPaths: ["ir.json"],
      sourceArtifactIds: [validatedIr.solution.artifactId]
    });
  }

  const generatedOutputSummary = [
    { label: "IR file", value: "`ir.json`" },
    { label: "Assessment report", value: "`assessment-report.md`" },
    {
      label: "SQL outputs",
      value: `${sqlGeneration.output.tablesGenerated} tables, ${sqlGeneration.output.columnsGenerated} columns`
    },
    {
      label: "React outputs",
      value: `${reactGeneration.output.appsGenerated} apps, ${reactGeneration.output.screensGenerated} screens`
    },
    {
      label: "Functions outputs",
      value: `${functionsGeneration.output.functionsGenerated} functions (${functionsGeneration.output.flowFunctionsGenerated} flow + ${functionsGeneration.output.canvasApiFunctionsGenerated} canvas API)`
    },
    {
      label: "Infra outputs",
      value: `${infraGeneration.output.resourcesPlanned} resources across ${infraGeneration.output.modulesPlanned} modules`
    }
  ];

  const baseArtifacts: GeneratedArtifact[] = [
    {
      artifactId: "generated:migrate:ir-json",
      artifactType: "ir-json",
      filePath: "ir.json",
      content: serializedIr,
      sourceArtifactIds: [validatedIr.solution.artifactId],
      warnings: [],
      provenance: generatorContext.invocationProvenance,
      confidence: validatedIr.confidence
    },
    {
      artifactId: "generated:migrate:assessment-report",
      artifactType: "markdown-report",
      filePath: "assessment-report.md",
      content: assessmentReport,
      sourceArtifactIds: [validatedIr.solution.artifactId],
      warnings: [],
      provenance: generatorContext.invocationProvenance,
      confidence: assessment.overallConfidence
    },
    ...sqlArtifacts,
    ...reactArtifacts,
    ...functionsArtifacts,
    ...infraArtifacts
  ];
  const seedPlan = planGeneration({
    artifacts: baseArtifacts,
    existingFiles: [],
    force: parsedArgs.force,
    warnings: combinedWarnings,
    unsupportedFeatures: combinedUnsupported,
    formulaHotspots: reactGeneration.output.formulaHotspots,
    manualReviewItems,
    sqlPlan: sqlGeneration.output.sqlPlan,
    functionsPlan: combinedFunctionsPlan,
    infraPlan: combinedInfraPlan
  }).plan;
  const migrationPlanContent = renderMasterMigrationPlanMarkdown({
    solutionFolder: parsedArgs.solutionFolder,
    ir: validatedIr,
    assessment,
    planSummary: seedPlan.summary,
    generatedOutputs: generatedOutputSummary,
    manualReviewItems
  });
  const migrationPlanArtifact: GeneratedArtifact = {
    artifactId: "generated:migrate:migration-plan",
    artifactType: "markdown-report",
    filePath: "migration-plan.md",
    content: migrationPlanContent,
    sourceArtifactIds: [validatedIr.solution.artifactId],
    warnings: [],
    provenance: generatorContext.invocationProvenance,
    confidence: assessment.overallConfidence
  };
  const allArtifacts = [...baseArtifacts, migrationPlanArtifact];
  const artifactPaths = allArtifacts.map((artifact) => artifact.filePath);
  let existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
  if (parsedArgs.clean) {
    if (parsedArgs.dryRun) {
      existingFiles = existingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content));
    } else {
      await cleanGeneratedFiles(parsedArgs.outputFolder);
      existingFiles = await loadExistingFiles(parsedArgs.outputFolder, artifactPaths);
    }
  }

  let planned = planGeneration({
    artifacts: allArtifacts,
    existingFiles,
    force: parsedArgs.force,
    warnings: combinedWarnings,
    unsupportedFeatures: combinedUnsupported,
    formulaHotspots: reactGeneration.output.formulaHotspots,
    manualReviewItems,
    sqlPlan: sqlGeneration.output.sqlPlan,
    functionsPlan: combinedFunctionsPlan,
    infraPlan: combinedInfraPlan
  });
  let gateStatus: "pass" | "warn" | "fail" | null = null;

  if (parsedArgs.gate.enabled) {
    const resolvedPolicy = await resolveGatePolicyProfile({
      policyFilePath: parsedArgs.gate.policyFilePath,
      profileName: parsedArgs.gate.profileName
    });
    const gateEvaluation = buildReadinessGateEvaluation({
      ir: validatedIr,
      assessment,
      generationPlan: planned.plan,
      policyProfile: resolvedPolicy.policyProfile,
      sourcePolicyFile: resolvedPolicy.sourcePolicyFile,
      thresholds: parsedArgs.gate.thresholds
    });
    const gateArtifacts: GeneratedArtifact[] = [
      {
        artifactId: "generated:migrate:readiness-gate-json",
        artifactType: "json-report",
        filePath: "readiness-gate.json",
        content: gateEvaluation.json,
        sourceArtifactIds: [validatedIr.solution.artifactId],
        warnings: [],
        provenance: generatorContext.invocationProvenance,
        confidence: assessment.overallConfidence
      },
      {
        artifactId: "generated:migrate:readiness-gate-markdown",
        artifactType: "markdown-report",
        filePath: "readiness-gate.md",
        content: gateEvaluation.markdown,
        sourceArtifactIds: [validatedIr.solution.artifactId],
        warnings: [],
        provenance: generatorContext.invocationProvenance,
        confidence: assessment.overallConfidence
      }
    ];
    const gateExistingFiles = await loadExistingFiles(
      parsedArgs.outputFolder,
      gateArtifacts.map((artifact) => artifact.filePath)
    );
    const allExistingFiles = [
      ...existingFiles,
      ...gateExistingFiles.filter(
        (gateFile) => !existingFiles.some((existing) => existing.path === gateFile.path)
      )
    ];
    const filteredExistingFiles =
      parsedArgs.clean && parsedArgs.dryRun
        ? allExistingFiles.filter((entry) => !hasGeneratedFileMarker(entry.content))
        : allExistingFiles;

    planned = planGeneration({
      artifacts: [...allArtifacts, ...gateArtifacts],
      existingFiles: filteredExistingFiles,
      force: parsedArgs.force,
      warnings: combinedWarnings,
      unsupportedFeatures: combinedUnsupported,
      formulaHotspots: reactGeneration.output.formulaHotspots,
      manualReviewItems,
      sqlPlan: sqlGeneration.output.sqlPlan,
      functionsPlan: combinedFunctionsPlan,
      infraPlan: combinedInfraPlan
    });
    gateStatus = gateEvaluation.gate.status;
  }

  await writeGenerationPlanFiles(
    parsedArgs.outputFolder,
    serializeGenerationPlan(planned.plan),
    renderGenerationPlanMarkdown(planned.plan)
  );

  const artifactByPath = new Map(allArtifacts.map((artifact) => [artifact.filePath, artifact]));
  const writesToApply = parsedArgs.dryRun
    ? planned.writes.filter((writeEntry) =>
        isReportLikeArtifactType(artifactByPath.get(writeEntry.path)?.artifactType ?? "")
      )
    : planned.writes;
  await writePlannedArtifacts(parsedArgs.outputFolder, writesToApply);

  stdout(
    JSON.stringify({
      command: "migrate",
      status: "success",
      solutionFolder: parsedArgs.solutionFolder,
      outputFolder: parsedArgs.outputFolder,
      overallReadiness: assessment.overallReadiness,
      overallRiskScore: assessment.overallRiskScore,
      overallComplexityScore: assessment.overallComplexityScore,
      tablesGenerated: sqlGeneration.output.tablesGenerated,
      reactAppsGenerated: reactGeneration.output.appsGenerated,
      functionsGenerated: functionsGeneration.output.functionsGenerated,
      infraResourcesPlanned: infraGeneration.output.resourcesPlanned,
      warnings: planned.plan.summary.warnings,
      unsupportedFeatures: planned.plan.summary.unsupportedFeatures,
      dryRun: parsedArgs.dryRun,
      force: parsedArgs.force,
      clean: parsedArgs.clean,
      gate: parsedArgs.gate.enabled,
      gateStrict: parsedArgs.gate.strict,
      gatePolicy: parsedArgs.gate.policyFilePath ?? null,
      gateProfile: parsedArgs.gate.profileName ?? null,
      gateStatus,
      skippedFiles: planned.plan.skippedFiles.length,
      overwrittenFiles: planned.plan.overwrittenFiles.length,
      planSummary: planned.plan.summary
    })
  );
};

const formatError = (error: unknown): string => {
  if (error instanceof CliError) {
    return JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details ?? {}
    });
  }

  return JSON.stringify({
    code: "UNEXPECTED_ERROR",
    message: "Unexpected CLI failure.",
    details: {}
  });
};

export const runCli = async (
  args: string[],
  stdout: WriteFn = console.log,
  stderr: WriteFn = console.error
): Promise<number> => {
  try {
    const [command, ...commandArgs] = args;

    if (command === "analyse") {
      await executeAnalyse(commandArgs, stdout);
      return 0;
    }

    if (command === "report") {
      await executeReport(commandArgs, stdout);
      return 0;
    }

    if (command === "generate") {
      await executeGenerate(commandArgs, stdout);
      return 0;
    }

    if (command === "migrate") {
      await executeMigrate(commandArgs, stdout);
      return 0;
    }

    if (command === "gate") {
      return await executeGate(commandArgs, stdout);
    }

    if (command === "init-policy") {
      await executeInitPolicy(commandArgs, stdout);
      return 0;
    }

    if (!command) {
      throw new CliError(
        "INVALID_COMMAND",
        "No command provided."
      );
    }

    throw new CliError(
      "INVALID_COMMAND",
      "Supported commands are: analyse, report, generate, migrate, gate, init-policy."
    );
  } catch (error) {
    stderr(formatError(error));
    return 1;
  }
};

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exit(exitCode);
  });
}
