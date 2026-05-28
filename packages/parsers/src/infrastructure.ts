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
  provenance: SourceProvenance,
  sourceLocation: string,
  warnings: ParserWarning[]
): EnvironmentVariable[] => {
  const entries = asArray(
    getNestedValue(xmlDocument, ["EnvironmentVariables", "EnvironmentVariable"])
  );

  return entries
    .map((entry) => {
      const schemaName = getTextAt(entry, ["SchemaName"]) ?? "";

      if (!schemaName) {
        warnings.push(
          createWarning({
            code: "ENVIRONMENT_VARIABLE_MISSING_SCHEMA_NAME",
            message: "Environment variable entry is missing schema name.",
            sourceLocation,
            provenance,
            confidence: 0.95
          })
        );
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
  provenance: SourceProvenance,
  sourceLocation: string,
  warnings: ParserWarning[]
): ConnectionReference[] => {
  const entries = asArray(
    getNestedValue(xmlDocument, ["ConnectionReferences", "ConnectionReference"])
  );

  return entries
    .map((entry) => {
      const logicalName = getTextAt(entry, ["LogicalName"]) ?? "";

      if (!logicalName) {
        warnings.push(
          createWarning({
            code: "CONNECTION_REFERENCE_MISSING_LOGICAL_NAME",
            message: "Connection reference entry is missing logical name.",
            sourceLocation,
            provenance,
            confidence: 0.95
          })
        );
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
  provenance: SourceProvenance,
  sourceLocation: string,
  warnings: ParserWarning[]
): SecurityRole[] => {
  const entries = asArray(getNestedValue(xmlDocument, ["Roles", "Role"]));
  const roles: SecurityRole[] = [];

  for (const entry of entries) {
    const roleName = getTextAt(entry, ["Name", "RoleName"]) ?? "";

    if (!roleName) {
      warnings.push(
        createWarning({
          code: "SECURITY_ROLE_MISSING_NAME",
          message: "Security role entry is missing a name and was skipped.",
          sourceLocation,
          provenance,
          confidence: 0.95
        })
      );
      continue;
    }

    const rawPrivileges = asArray(getNestedValue(entry, ["Privileges", "Privilege"]));
    const privileges: SecurityRole["privileges"] = [];

    for (const privilege of rawPrivileges) {
      const privilegeName = getTextAt(privilege, ["Name", "PrivilegeName"]);

      if (!privilegeName) {
        warnings.push(
          createWarning({
            code: "SECURITY_ROLE_UNRESOLVED_PRIVILEGE",
            message: "Role privilege entry is missing privilege name.",
            sourceLocation,
            provenance,
            confidence: 0.95
          })
        );
        continue;
      }

      let entityLogicalName = getTextAt(privilege, ["EntityLogicalName", "Entity"]);

      if (!entityLogicalName) {
        const match =
          /^prv(?:Read|Write|Create|Delete|Append|AppendTo|Assign|Share)(.+)$/i.exec(
            privilegeName
          );

        if (!match || !match[1]) {
          warnings.push(
            createWarning({
              code: "SECURITY_ROLE_UNRESOLVED_PRIVILEGE_ENTITY",
              message: `Privilege "${privilegeName}" does not expose an entity mapping.`,
              sourceLocation,
              provenance,
              confidence: 0.85
            })
          );
        } else {
          entityLogicalName = match[1].toLowerCase();
        }
      }

      privileges.push({
        privilegeName,
        entityLogicalName,
        scope: getTextAt(privilege, ["Scope"]) ?? "Unknown",
        provenance,
        confidence: 0.85
      });
    }

    roles.push({
      artifactId: buildArtifactId("security-role", roleName),
      roleName,
      privileges: sorted(
        privileges,
        (privilege) => `${privilege.privilegeName}:${privilege.scope}`
      ),
      provenance,
      confidence: 0.9
    });
  }

  return roles;
};

export const parseSolutionInfrastructure = async (
  solutionPath: string,
  discovery: SolutionDiscoveryData
): Promise<ParseResult<InfrastructureParseData>> => {
  const environmentVariableMap = new Map<string, EnvironmentVariable>();
  const connectionReferenceMap = new Map<string, ConnectionReference>();
  const securityRoleMap = new Map<string, SecurityRole>();
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
      for (const parsedEnvironmentVariable of parseEnvironmentVariablesFromFile(
        parsedXml,
        provenance,
        file.path,
        warnings
      )) {
        const duplicate = environmentVariableMap.get(parsedEnvironmentVariable.schemaName);

        if (!duplicate) {
          environmentVariableMap.set(
            parsedEnvironmentVariable.schemaName,
            parsedEnvironmentVariable
          );
          continue;
        }

        if (
          duplicate.type !== parsedEnvironmentVariable.type ||
          duplicate.defaultValue !== parsedEnvironmentVariable.defaultValue
        ) {
          warnings.push(
            createWarning({
              code: "ENVIRONMENT_VARIABLE_CONFLICT",
              message: `Conflicting environment variable metadata for "${parsedEnvironmentVariable.schemaName}".`,
              sourceLocation: file.path,
              provenance,
              confidence: 0.95
            })
          );
        } else {
          warnings.push(
            createWarning({
              code: "ENVIRONMENT_VARIABLE_DUPLICATE",
              message: `Duplicate environment variable metadata for "${parsedEnvironmentVariable.schemaName}".`,
              sourceLocation: file.path,
              provenance,
              confidence: 0.95
            })
          );
        }
      }
      continue;
    }

    if (file.classification === "connection-reference") {
      for (const parsedConnectionReference of parseConnectionReferencesFromFile(
        parsedXml,
        provenance,
        file.path,
        warnings
      )) {
        const duplicate = connectionReferenceMap.get(parsedConnectionReference.logicalName);

        if (!duplicate) {
          connectionReferenceMap.set(
            parsedConnectionReference.logicalName,
            parsedConnectionReference
          );
          continue;
        }

        if (
          duplicate.connectorType !== parsedConnectionReference.connectorType ||
          duplicate.connectionMetadata !== parsedConnectionReference.connectionMetadata
        ) {
          warnings.push(
            createWarning({
              code: "CONNECTION_REFERENCE_CONFLICT",
              message: `Conflicting connection reference metadata for "${parsedConnectionReference.logicalName}".`,
              sourceLocation: file.path,
              provenance,
              confidence: 0.95
            })
          );
        } else {
          warnings.push(
            createWarning({
              code: "CONNECTION_REFERENCE_DUPLICATE",
              message: `Duplicate connection reference metadata for "${parsedConnectionReference.logicalName}".`,
              sourceLocation: file.path,
              provenance,
              confidence: 0.95
            })
          );
        }
      }
      continue;
    }

    for (const parsedSecurityRole of parseSecurityRolesFromFile(
      parsedXml,
      provenance,
      file.path,
      warnings
    )) {
      const duplicate = securityRoleMap.get(parsedSecurityRole.roleName);

      if (!duplicate) {
        securityRoleMap.set(parsedSecurityRole.roleName, parsedSecurityRole);
        continue;
      }

      if (duplicate.privileges.length !== parsedSecurityRole.privileges.length) {
        warnings.push(
          createWarning({
            code: "SECURITY_ROLE_CONFLICT",
            message: `Conflicting security role metadata for "${parsedSecurityRole.roleName}".`,
            sourceLocation: file.path,
            provenance,
            confidence: 0.95
          })
        );
      } else {
        warnings.push(
          createWarning({
            code: "SECURITY_ROLE_DUPLICATE",
            message: `Duplicate security role metadata for "${parsedSecurityRole.roleName}".`,
            sourceLocation: file.path,
            provenance,
            confidence: 0.95
          })
        );
      }
    }
  }

  const environmentVariables = sorted(
    Array.from(environmentVariableMap.values()),
    (environmentVariable) => environmentVariable.schemaName
  );
  const connectionReferences = sorted(
    Array.from(connectionReferenceMap.values()),
    (connectionReference) => connectionReference.logicalName
  );
  const securityRoles = sorted(
    Array.from(securityRoleMap.values()),
    (role) => role.roleName
  );

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
        roles: securityRoles
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
