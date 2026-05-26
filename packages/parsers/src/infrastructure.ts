import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createWarning,
  type ParserWarning,
  type ConnectionReference,
  type EnvironmentVariable,
  type ParseResult,
  type SecurityRole,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import { asArray, buildArtifactId, clampConfidence, getNestedValue, getTextAt, sorted } from "./utils";
import { parseXmlDocument } from "./xml";
import type { SolutionDiscoveryData } from "./solution-discovery";

export interface InfrastructureParseData {
  environmentVariables: EnvironmentVariable[];
  connectionReferences: ConnectionReference[];
  security: {
    roles: SecurityRole[];
  };
}

const parseEnvironmentVariablesFromFile = (
  xmlDocument: unknown,
  provenance: SourceProvenance
): EnvironmentVariable[] => {
  const entries = asArray(
    getNestedValue(xmlDocument, ["EnvironmentVariables", "EnvironmentVariable"])
  );

  return entries
    .map((entry) => {
      const schemaName = getTextAt(entry, ["SchemaName"]) ?? "";

      if (!schemaName) {
        return undefined;
      }

      const defaultValue = getTextAt(entry, ["DefaultValue"]);
      const parsed: EnvironmentVariable = {
        artifactId: buildArtifactId("env-var", schemaName),
        schemaName,
        type: getTextAt(entry, ["Type"]) ?? "Unknown",
        provenance,
        confidence: 0.9
      };

      if (defaultValue !== undefined) {
        parsed.defaultValue = defaultValue;
      }

      return parsed;
    })
    .filter((entry): entry is EnvironmentVariable => Boolean(entry));
};

const parseConnectionReferencesFromFile = (
  xmlDocument: unknown,
  provenance: SourceProvenance
): ConnectionReference[] => {
  const entries = asArray(
    getNestedValue(xmlDocument, ["ConnectionReferences", "ConnectionReference"])
  );

  return entries
    .map((entry) => {
      const logicalName = getTextAt(entry, ["LogicalName"]) ?? "";

      if (!logicalName) {
        return undefined;
      }

      const connectionMetadata = getTextAt(entry, ["ConnectionMetadata"]);
      const parsed: ConnectionReference = {
        artifactId: buildArtifactId("connection-reference", logicalName),
        logicalName,
        connectorType: getTextAt(entry, ["ConnectorType"]) ?? "Unknown",
        provenance,
        confidence: 0.9
      };

      if (connectionMetadata !== undefined) {
        parsed.connectionMetadata = connectionMetadata;
      }

      return parsed;
    })
    .filter((entry): entry is ConnectionReference => Boolean(entry));
};

const parseSecurityRolesFromFile = (
  xmlDocument: unknown,
  provenance: SourceProvenance
): SecurityRole[] => {
  const entries = asArray(getNestedValue(xmlDocument, ["Roles", "Role"]));

  return entries
    .map((entry) => {
      const roleName = getTextAt(entry, ["Name", "RoleName"]) ?? "";

      if (!roleName) {
        return undefined;
      }

      const rawPrivileges = asArray(getNestedValue(entry, ["Privileges", "Privilege"]));
      const privileges = rawPrivileges
        .map((privilege) => {
          const privilegeName = getTextAt(privilege, ["Name", "PrivilegeName"]);

          if (!privilegeName) {
            return undefined;
          }

          return {
            privilegeName,
            scope: getTextAt(privilege, ["Scope"]) ?? "Unknown",
            provenance,
            confidence: 0.85
          };
        })
        .filter(
          (
            privilege
          ): privilege is SecurityRole["privileges"][number] => Boolean(privilege)
        );

      return {
        artifactId: buildArtifactId("security-role", roleName),
        roleName,
        privileges: sorted(
          privileges,
          (privilege) => `${privilege.privilegeName}:${privilege.scope}`
        ),
        provenance,
        confidence: 0.9
      } satisfies SecurityRole;
    })
    .filter((entry): entry is SecurityRole => Boolean(entry));
};

export const parseSolutionInfrastructure = async (
  solutionPath: string,
  discovery: SolutionDiscoveryData
): Promise<ParseResult<InfrastructureParseData>> => {
  const environmentVariables: EnvironmentVariable[] = [];
  const connectionReferences: ConnectionReference[] = [];
  const securityRoles: SecurityRole[] = [];
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];

  for (const file of discovery.files) {
    if (
      file.classification !== "environment-variable" &&
      file.classification !== "connection-reference" &&
      file.classification !== "security-role"
    ) {
      continue;
    }

    const filePath = path.join(solutionPath, file.path);
    const provenance: SourceProvenance = {
      sourcePath: file.path,
      sourceType:
        file.classification === "security-role" ? "security" : file.classification
    };

    let parsedXml: unknown;

    try {
      parsedXml = parseXmlDocument(await readFile(filePath, "utf-8"));
    } catch {
      warnings.push(
        createWarning({
          code: "INFRASTRUCTURE_XML_INVALID",
          message: "Infrastructure metadata XML could not be parsed.",
          sourceLocation: file.path,
          provenance,
          severity: "error",
          confidence: 1
        })
      );
      continue;
    }

    if (file.classification === "environment-variable") {
      environmentVariables.push(
        ...parseEnvironmentVariablesFromFile(parsedXml, provenance)
      );
      continue;
    }

    if (file.classification === "connection-reference") {
      connectionReferences.push(
        ...parseConnectionReferencesFromFile(parsedXml, provenance)
      );
      continue;
    }

    securityRoles.push(...parseSecurityRolesFromFile(parsedXml, provenance));
  }

  const denominator =
    environmentVariables.length + connectionReferences.length + securityRoles.length + 1;
  const confidence = clampConfidence(1 - warnings.length / (denominator * 3));

  return {
    data: {
      environmentVariables: sorted(
        environmentVariables,
        (environmentVariable) => environmentVariable.schemaName
      ),
      connectionReferences: sorted(
        connectionReferences,
        (connectionReference) => connectionReference.logicalName
      ),
      security: {
        roles: sorted(securityRoles, (role) => role.roleName)
      }
    },
    warnings,
    unsupported,
    confidence,
    provenance: {
      sourcePath: solutionPath,
      sourceType: "solution"
    }
  };
};
