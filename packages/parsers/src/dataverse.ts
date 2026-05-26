import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createUnsupportedFeature,
  createWarning,
  dataverseAttributeTypeSchema,
  type ParserWarning,
  type DataverseAttribute,
  type DataverseEntity,
  type DataverseOptionSet,
  type DataverseRelationship,
  type ParseResult,
  type SourceProvenance,
  type UnsupportedFeature
} from "@power-exit/ir";

import { asArray, buildArtifactId, clampConfidence, getNestedValue, getTextAt, sorted } from "./utils";
import { parseXmlDocument } from "./xml";
import type { SolutionDiscoveryData } from "./solution-discovery";

type DataverseParseData = {
  entities: DataverseEntity[];
  relationships: DataverseRelationship[];
  optionSets: DataverseOptionSet[];
};

const SUPPORTED_ATTRIBUTE_TYPES = new Map<string, DataverseAttribute["type"]>([
  ["string", "string"],
  ["memo", "memo"],
  ["nvarchar", "string"],
  ["integer", "integer"],
  ["int", "integer"],
  ["decimal", "decimal"],
  ["float", "float"],
  ["money", "money"],
  ["boolean", "boolean"],
  ["datetime", "datetime"],
  ["lookup", "lookup"],
  ["picklist", "picklist"],
  ["multiselectpicklist", "multiselectpicklist"],
  ["owner", "owner"],
  ["state", "state"],
  ["status", "status"],
  ["uniqueidentifier", "uniqueidentifier"]
]);

const normalizeAttributeType = (rawType: string): DataverseAttribute["type"] =>
  SUPPORTED_ATTRIBUTE_TYPES.get(rawType.toLowerCase()) ?? "unknown";

const normalizeRequiredLevel = (raw: string): DataverseAttribute["requiredLevel"] => {
  const normalized = raw.toLowerCase();

  if (normalized === "recommended") {
    return "recommended";
  }

  if (normalized === "applicationrequired") {
    return "applicationRequired";
  }

  if (normalized === "systemrequired") {
    return "systemRequired";
  }

  return "none";
};

const parseNumeric = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
};

export const parseDataverseMetadata = async (
  solutionPath: string,
  discovery: SolutionDiscoveryData
): Promise<ParseResult<DataverseParseData>> => {
  const files = discovery.files.filter(
    (file) => file.classification === "entity-metadata"
  );
  const warnings: ParserWarning[] = [];
  const unsupported: UnsupportedFeature[] = [];
  const entities: DataverseEntity[] = [];
  const relationships: DataverseRelationship[] = [];
  const optionSets: DataverseOptionSet[] = [];

  for (const file of files) {
    const filePath = path.join(solutionPath, file.path);
    const provenance: SourceProvenance = {
      sourcePath: file.path,
      sourceType: "dataverse"
    };

    let parsedXml: unknown;

    try {
      const xml = await readFile(filePath, "utf-8");
      parsedXml = parseXmlDocument(xml);
    } catch {
      warnings.push(
        createWarning({
          code: "DATAVERSE_ENTITY_INVALID_XML",
          message: "Dataverse entity metadata XML could not be parsed.",
          sourceLocation: file.path,
          provenance,
          severity: "error",
          confidence: 1
        })
      );
      continue;
    }

    const entityNode =
      getNestedValue(parsedXml, ["Entity"]) ??
      getNestedValue(parsedXml, ["EntityMetadata"]) ??
      parsedXml;
    const entityLogicalName =
      getTextAt(entityNode, ["LogicalName", "logicalName"]) ?? "";
    const entitySchemaName =
      getTextAt(entityNode, ["SchemaName", "schemaName"]) ?? entityLogicalName;
    const entityDisplayName =
      getTextAt(entityNode, ["DisplayName", "displayName"]) || entityLogicalName;
    const ownershipType = getTextAt(entityNode, ["OwnershipType"]) ?? "unknown";
    const primaryNameAttribute =
      getTextAt(entityNode, ["PrimaryNameAttribute"]) ?? "";
    const primaryIdAttribute = getTextAt(entityNode, ["PrimaryIdAttribute"]) ?? "";

    if (!entityLogicalName || !entitySchemaName) {
      warnings.push(
        createWarning({
          code: "DATAVERSE_ENTITY_MISSING_KEYS",
          message: "Entity metadata is missing logical/schema name and was skipped.",
          sourceLocation: file.path,
          provenance,
          confidence: 0.9
        })
      );
      continue;
    }

    const entityArtifactId = buildArtifactId("entity", entityLogicalName);
    const attributes: DataverseAttribute[] = [];
    const rawAttributes = asArray(getNestedValue(entityNode, ["Attributes", "Attribute"]));

    for (const rawAttribute of rawAttributes) {
      const logicalName =
        getTextAt(rawAttribute, ["LogicalName", "logicalName"]) ?? "";

      if (!logicalName) {
        warnings.push(
          createWarning({
            code: "DATAVERSE_ATTRIBUTE_MISSING_LOGICAL_NAME",
            message: "Attribute without logical name was skipped.",
            sourceLocation: file.path,
            provenance,
            confidence: 0.9
          })
        );
        continue;
      }

      const rawType = getTextAt(rawAttribute, ["Type", "AttributeType"]) ?? "unknown";
      const type = normalizeAttributeType(rawType);

      if (!dataverseAttributeTypeSchema.safeParse(type).success) {
        continue;
      }

      if (type === "unknown") {
        warnings.push(
          createWarning({
            code: "DATAVERSE_ATTRIBUTE_UNSUPPORTED_TYPE",
            message: `Attribute type "${rawType}" is not supported.`,
            sourceLocation: file.path,
            provenance,
            confidence: 0.9
          })
        );
        unsupported.push(
          createUnsupportedFeature({
            featureType: `dataverse.attribute-type.${rawType.toLowerCase()}`,
            sourceLocation: file.path,
            reason: "Attribute type is unsupported by the current parser pass.",
            suggestedRemediation:
              "Map the attribute to a supported Dataverse type before migration.",
            severity: "medium",
            confidence: 0.9,
            provenance
          })
        );
      }

      attributes.push({
        artifactId: buildArtifactId(
          "attribute",
          `${entityLogicalName}-${logicalName}`
        ),
        entityArtifactId,
        logicalName,
        schemaName:
          getTextAt(rawAttribute, ["SchemaName", "schemaName"]) ?? logicalName,
        type,
        requiredLevel: normalizeRequiredLevel(
          getTextAt(rawAttribute, ["RequiredLevel"]) ?? "none"
        ),
        maxLength: parseNumeric(getTextAt(rawAttribute, ["MaxLength"])),
        precision: parseNumeric(getTextAt(rawAttribute, ["Precision"])),
        scale: parseNumeric(getTextAt(rawAttribute, ["Scale"])),
        provenance,
        confidence: type === "unknown" ? 0.6 : 0.9
      });
    }

    const relationshipGroups: Array<{
      type: DataverseRelationship["relationshipType"];
      path: string[];
    }> = [
      { type: "one-to-many", path: ["Relationships", "OneToMany", "Relationship"] },
      { type: "many-to-one", path: ["Relationships", "ManyToOne", "Relationship"] },
      { type: "many-to-many", path: ["Relationships", "ManyToMany", "Relationship"] }
    ];

    for (const group of relationshipGroups) {
      const entries = asArray(getNestedValue(entityNode, group.path));

      for (const entry of entries) {
        const schemaName = getTextAt(entry, ["SchemaName"]) ?? "";

        if (!schemaName) {
          warnings.push(
            createWarning({
              code: "DATAVERSE_RELATIONSHIP_MISSING_SCHEMA_NAME",
              message: "Relationship without schema name was skipped.",
              sourceLocation: file.path,
              provenance,
              confidence: 0.9
            })
          );
          continue;
        }

        relationships.push({
          artifactId: buildArtifactId("relationship", schemaName),
          schemaName,
          relationshipType: group.type,
          fromEntityLogicalName:
            getTextAt(entry, ["FromEntity", "ReferencingEntity"]) ??
            entityLogicalName,
          toEntityLogicalName:
            getTextAt(entry, ["ToEntity", "ReferencedEntity"]) ??
            entityLogicalName,
          provenance,
          confidence: 0.85
        });
      }
    }

    const rawOptionSets = asArray(getNestedValue(entityNode, ["OptionSets", "OptionSet"]));

    for (const rawOptionSet of rawOptionSets) {
      const logicalName = getTextAt(rawOptionSet, ["LogicalName"]) ?? "";

      if (!logicalName) {
        warnings.push(
          createWarning({
            code: "DATAVERSE_OPTIONSET_MISSING_LOGICAL_NAME",
            message: "Option set without logical name was skipped.",
            sourceLocation: file.path,
            provenance,
            confidence: 0.9
          })
        );
        continue;
      }

      const options = asArray(getNestedValue(rawOptionSet, ["Options", "Option"]))
        .map((option) => {
          const value = parseNumeric(getTextAt(option, ["Value"]));
          const label = getTextAt(option, ["Label"]);

          if (value === undefined || !label) {
            return undefined;
          }

          return {
            value,
            label
          };
        })
        .filter((value): value is { value: number; label: string } => Boolean(value));

      optionSets.push({
        artifactId: buildArtifactId("optionset", logicalName),
        logicalName,
        isGlobal:
          (getTextAt(rawOptionSet, ["IsGlobal"]) ?? "false").toLowerCase() === "true",
        options: sorted(options, (option) => `${option.value}:${option.label}`),
        provenance,
        confidence: options.length > 0 ? 0.9 : 0.7
      });
    }

    entities.push({
      artifactId: entityArtifactId,
      logicalName: entityLogicalName,
      schemaName: entitySchemaName,
      displayName: entityDisplayName,
      ownershipType,
      primaryNameAttribute,
      primaryIdAttribute,
      attributes: sorted(attributes, (attribute) => attribute.logicalName),
      provenance,
      confidence: clampConfidence(1 - warnings.length * 0.02)
    });
  }

  const total = entities.length + warnings.length + unsupported.length;
  const confidence = total === 0 ? 1 : clampConfidence(1 - warnings.length / (total * 2));

  return {
    data: {
      entities: sorted(entities, (entity) => entity.logicalName),
      relationships: sorted(relationships, (relationship) => relationship.schemaName),
      optionSets: sorted(optionSets, (optionSet) => optionSet.logicalName)
    },
    warnings,
    unsupported,
    confidence,
    provenance: {
      sourcePath: solutionPath,
      sourceType: "dataverse"
    }
  };
};
