import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  createWarning,
  type ParseResult,
  type ParserWarning,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import { clampConfidence, sorted, toPosixRelativePath } from "./utils";

export type FileClassification =
  | "solution-manifest"
  | "customizations"
  | "entity-metadata"
  | "workflows-folder"
  | "canvas-source"
  | "web-resource"
  | "plugin-metadata"
  | "security-role"
  | "environment-variable"
  | "connection-reference"
  | "unknown";

export interface DiscoveredFile {
  path: string;
  classification: FileClassification;
  provenance: SourceProvenance;
}

export interface SolutionDiscoveryData {
  rootPath: string;
  files: DiscoveredFile[];
  filesScanned: number;
}

const classifyFile = (relativePath: string): FileClassification => {
  const normalized = relativePath.toLowerCase();
  const fileName = path.basename(normalized);

  if (fileName === "solution.xml") {
    return "solution-manifest";
  }

  if (fileName === "customizations.xml") {
    return "customizations";
  }

  if (normalized.includes("/entities/") && normalized.endsWith(".xml")) {
    return "entity-metadata";
  }

  if (normalized.includes("/workflows/")) {
    return "workflows-folder";
  }

  if (normalized.includes("/canvas") || normalized.includes("/canvasapps/")) {
    return "canvas-source";
  }

  if (normalized.includes("/webresources/")) {
    return "web-resource";
  }

  if (normalized.includes("/plugins/") || normalized.includes("/pluginassemblies/")) {
    return "plugin-metadata";
  }

  if (
    (normalized.includes("/securityroles/") || normalized.includes("/roles/")) &&
    normalized.endsWith(".xml")
  ) {
    return "security-role";
  }

  if (
    normalized.includes("/environmentvariable") &&
    normalized.endsWith(".xml")
  ) {
    return "environment-variable";
  }

  if (normalized.includes("/connectionreference") && normalized.endsWith(".xml")) {
    return "connection-reference";
  }

  return "unknown";
};

const walkFiles = async (directoryPath: string): Promise<string[]> => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const files: string[] = [];

  for (const entry of sortedEntries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
};

export const discoverSolutionFiles = async (
  solutionPath: string
): Promise<ParseResult<SolutionDiscoveryData>> => {
  const absoluteSolutionPath = path.resolve(solutionPath);
  const absoluteFiles = await walkFiles(absoluteSolutionPath);
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];

  const files = sorted(
    absoluteFiles.map((absolutePath) => {
      const relativePath = toPosixRelativePath(absoluteSolutionPath, absolutePath);
      const classification = classifyFile(`/${relativePath}`);
      const provenance: SourceProvenance = {
        sourcePath: relativePath,
        sourceType: "solution"
      };

      if (classification === "unknown") {
        warnings.push(
          createWarning({
            code: "UNKNOWN_FILE_LAYOUT",
            message: "Unknown file layout encountered during discovery.",
            sourceLocation: relativePath,
            provenance,
            confidence: 0.9
          })
        );
      }

      return {
        path: relativePath,
        classification,
        provenance
      };
    }),
    (file) => file.path
  );

  const confidencePenalty = files.length === 0 ? 1 : warnings.length / files.length / 4;
  const confidence = clampConfidence(1 - confidencePenalty);

  return {
    data: {
      rootPath: absoluteSolutionPath,
      files,
      filesScanned: files.length
    },
    warnings,
    unsupported,
    confidence,
    provenance: {
      sourcePath: absoluteSolutionPath,
      sourceType: "solution"
    }
  };
};
