#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeDeterministicIR, validatePowerPlatformIR } from "@power-exit/ir";
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
}

const parseAnalyseArgs = (args: string[]): AnalyseArgs => {
  if (args.length < 3) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Usage: power-exit analyse <solution-folder> --out <output-folder>"
    );
  }

  const [solutionFolder, ...flags] = args;
  const outIndex = flags.indexOf("--out");

  if (outIndex === -1 || outIndex === flags.length - 1) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Missing required --out <output-folder> argument."
    );
  }

  const outputFolder = flags[outIndex + 1];

  if (!outputFolder) {
    throw new CliError(
      "INVALID_ARGUMENTS",
      "Output folder argument cannot be empty."
    );
  }

  return {
    solutionFolder: path.resolve(solutionFolder),
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

  await writeFile(outputFile, serializedIr, "utf-8");

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
      confidence: validatedIr.confidence
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

    if (command !== "analyse") {
      throw new CliError(
        "INVALID_COMMAND",
        "Only the analyse command is supported in this pass."
      );
    }

    await executeAnalyse(commandArgs, stdout);
    return 0;
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
