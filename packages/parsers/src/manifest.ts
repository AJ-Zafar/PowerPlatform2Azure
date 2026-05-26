import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildArtifactId,
  clampConfidence,
  getNestedValue,
  getTextAt
} from "./utils";
import { parseXmlDocument } from "./xml";
import {
  createWarning,
  solutionMetadataSchema,
  type ParserWarning,
  type ParseResult,
  type SolutionMetadata,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import type { SolutionDiscoveryData } from "./solution-discovery";

const toLocalizedNames = (
  rawValue: unknown
): { languageCode: string; value: string }[] => {
  if (!rawValue) {
    return [];
  }

  const entries = Array.isArray(rawValue) ? rawValue : [rawValue];

  return entries
    .map((entry) => {
      if (entry === null || typeof entry !== "object") {
        return undefined;
      }

      const description = getTextAt(entry, ["description", "Description", "#text"]);
      const languageCode =
        getTextAt(entry, ["languagecode", "LanguageCode"]) ?? "neutral";

      if (!description) {
        return undefined;
      }

      return {
        languageCode,
        value: description
      };
    })
    .filter((value): value is { languageCode: string; value: string } =>
      Boolean(value)
    );
};

const createDefaultSolutionMetadata = (
  solutionPath: string,
  provenance: SourceProvenance
): SolutionMetadata =>
  solutionMetadataSchema.parse({
    artifactId: buildArtifactId("solution", path.basename(solutionPath)),
    name: path.basename(solutionPath) || "Unknown Solution",
    uniqueName: path.basename(solutionPath) || "unknown_solution",
    version: "0.0.0",
    sourceFolder: solutionPath,
    publisher: {
      uniqueName: "unknown_publisher",
      displayName: "Unknown Publisher"
    },
    managed: false,
    localizedNames: [],
    provenance,
    confidence: 0.4
  });

export const parseSolutionManifest = async (
  solutionPath: string,
  discovery: SolutionDiscoveryData
): Promise<ParseResult<SolutionMetadata>> => {
  const manifestFile = discovery.files.find(
    (file) => file.classification === "solution-manifest"
  );
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];
  const defaultProvenance: SourceProvenance = {
    sourcePath: solutionPath,
    sourceType: "solution"
  };

  if (!manifestFile) {
    warnings.push(
      createWarning({
        code: "SOLUTION_MANIFEST_MISSING",
        message: "No solution.xml manifest file was found in the scanned folder.",
        sourceLocation: solutionPath,
        provenance: defaultProvenance,
        confidence: 1
      })
    );

    return {
      data: createDefaultSolutionMetadata(solutionPath, defaultProvenance),
      warnings,
      unsupported,
      confidence: 0.2,
      provenance: defaultProvenance
    };
  }

  const manifestPath = path.join(solutionPath, manifestFile.path);
  const provenance: SourceProvenance = {
    sourcePath: manifestFile.path,
    sourceType: "solution"
  };

  let parsedXml: unknown;

  try {
    const xml = await readFile(manifestPath, "utf-8");
    parsedXml = parseXmlDocument(xml);
  } catch {
    warnings.push(
      createWarning({
        code: "SOLUTION_MANIFEST_INVALID_XML",
        message: "Manifest XML could not be parsed.",
        sourceLocation: manifestFile.path,
        provenance,
        severity: "error",
        confidence: 1
      })
    );

    return {
      data: createDefaultSolutionMetadata(solutionPath, provenance),
      warnings,
      unsupported,
      confidence: 0.1,
      provenance
    };
  }

  const manifestNode =
    getNestedValue(parsedXml, ["ImportExportXml", "SolutionManifest"]) ??
    getNestedValue(parsedXml, ["SolutionManifest"]) ??
    parsedXml;

  const uniqueName = getTextAt(manifestNode, ["UniqueName"]) ?? "unknown_solution";
  const version = getTextAt(manifestNode, ["Version"]) ?? "0.0.0";
  const managedRaw = getTextAt(manifestNode, ["Managed"]) ?? "0";
  const managed = managedRaw === "1" || managedRaw.toLowerCase() === "true";
  const localizedNames = toLocalizedNames(
    getNestedValue(manifestNode, ["LocalizedNames", "LocalizedName"])
  );
  const name = localizedNames[0]?.value ?? uniqueName;
  const publisherNode = getNestedValue(manifestNode, ["Publisher"]);
  const publisherUniqueName =
    getTextAt(publisherNode, ["UniqueName"]) ?? "unknown_publisher";
  const publisherDisplayName =
    toLocalizedNames(getNestedValue(publisherNode, ["LocalizedNames", "LocalizedName"]))[0]
      ?.value ?? publisherUniqueName;
  const knownManifestKeys = new Set([
    "UniqueName",
    "Version",
    "Managed",
    "LocalizedNames",
    "Publisher",
    "Descriptions",
    "RootComponents",
    "MissingDependencies",
    "VersionedComponentIds",
    "IntroducedVersion"
  ]);

  if (manifestNode && typeof manifestNode === "object") {
    for (const key of Object.keys(manifestNode)) {
      if (!knownManifestKeys.has(key)) {
        warnings.push(
          createWarning({
            code: "SOLUTION_MANIFEST_UNKNOWN_FIELD",
            message: `Unknown manifest field "${key}" was ignored.`,
            sourceLocation: manifestFile.path,
            provenance,
            confidence: 0.8
          })
        );
      }
    }
  }

  if (!getTextAt(manifestNode, ["UniqueName"])) {
    warnings.push(
      createWarning({
        code: "SOLUTION_MANIFEST_MISSING_UNIQUENAME",
        message: "Manifest does not include a unique name; fallback value was used.",
        sourceLocation: manifestFile.path,
        provenance,
        confidence: 0.9
      })
    );
  }

  const confidence = clampConfidence(1 - warnings.length * 0.05);

  return {
    data: solutionMetadataSchema.parse({
      artifactId: buildArtifactId("solution", uniqueName),
      name,
      uniqueName,
      version,
      sourceFolder: solutionPath,
      publisher: {
        uniqueName: publisherUniqueName,
        displayName: publisherDisplayName
      },
      managed,
      localizedNames,
      provenance,
      confidence
    }),
    warnings,
    unsupported,
    confidence,
    provenance
  };
};
