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

const conflictWarning = (
  code: string,
  message: string,
  sourceLocation: string,
  provenance: SourceProvenance
) =>
  createWarning({
    code,
    message,
    sourceLocation,
    provenance,
    confidence: 0.9
  });

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
  const entityMap = new Map<string, DataverseEntity>();
  const relationshipMap = new Map<string, DataverseRelationship>();
  const optionSetMap = new Map<string, DataverseOptionSet>();

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
      getTextAt(entityNode, ["DisplayName", "displayName"]) ?? entityLogicalName;
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

    if (!primaryNameAttribute || !primaryIdAttribute) {
      warnings.push(
        createWarning({
          code: "DATAVERSE_ENTITY_MISSING_REQUIRED_FIELDS",
          message:
            "Entity metadata is missing primary name/id attribute information.",
          sourceLocation: file.path,
          provenance,
          confidence: 0.9
        })
      );
    }

    const entityArtifactId = buildArtifactId("entity", entityLogicalName);
    const attributeMap = new Map<string, DataverseAttribute>();
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

      const schemaName =
        getTextAt(rawAttribute, ["SchemaName", "schemaName"]) ?? logicalName;

      if (!schemaName) {
        warnings.push(
          createWarning({
            code: "DATAVERSE_ATTRIBUTE_MISSING_REQUIRED_FIELDS",
            message: "Attribute metadata is missing schema name information.",
            sourceLocation: file.path,
            provenance,
            confidence: 0.9
          })
        );
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

      const parsedAttribute: DataverseAttribute = {
        artifactId: buildArtifactId(
          "attribute",
          `${entityLogicalName}-${logicalName}`
        ),
        entityArtifactId,
        logicalName,
        schemaName,
        type,
        requiredLevel: normalizeRequiredLevel(
          getTextAt(rawAttribute, ["RequiredLevel"]) ?? "none"
        ),
        maxLength: parseNumeric(getTextAt(rawAttribute, ["MaxLength"])),
        precision: parseNumeric(getTextAt(rawAttribute, ["Precision"])),
        scale: parseNumeric(getTextAt(rawAttribute, ["Scale"])),
        provenance,
        confidence: type === "unknown" ? 0.6 : 0.9
      };
      const duplicateAttribute = attributeMap.get(logicalName);

      if (!duplicateAttribute) {
        attributeMap.set(logicalName, parsedAttribute);
      } else if (
        duplicateAttribute.type !== parsedAttribute.type ||
        duplicateAttribute.schemaName !== parsedAttribute.schemaName
      ) {
        warnings.push(
          conflictWarning(
            "DATAVERSE_ATTRIBUTE_CONFLICT",
            `Conflicting attribute metadata detected for "${logicalName}".`,
            file.path,
            provenance
          )
        );
      } else {
        warnings.push(
          conflictWarning(
            "DATAVERSE_ATTRIBUTE_DUPLICATE",
            `Duplicate attribute metadata detected for "${logicalName}".`,
            file.path,
            provenance
          )
        );
      }
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

        const parsedRelationship: DataverseRelationship = {
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
        };
        const duplicateRelationship = relationshipMap.get(schemaName);

        if (!duplicateRelationship) {
          relationshipMap.set(schemaName, parsedRelationship);
        } else if (
          duplicateRelationship.fromEntityLogicalName !==
            parsedRelationship.fromEntityLogicalName ||
          duplicateRelationship.toEntityLogicalName !== parsedRelationship.toEntityLogicalName
        ) {
          warnings.push(
            conflictWarning(
              "DATAVERSE_RELATIONSHIP_CONFLICT",
              `Conflicting relationship metadata detected for "${schemaName}".`,
              file.path,
              provenance
            )
          );
        } else {
          warnings.push(
            conflictWarning(
              "DATAVERSE_RELATIONSHIP_DUPLICATE",
              `Duplicate relationship metadata detected for "${schemaName}".`,
              file.path,
              provenance
            )
          );
        }
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

      const parsedOptionSet: DataverseOptionSet = {
        artifactId: buildArtifactId("optionset", logicalName),
        logicalName,
        isGlobal:
          (getTextAt(rawOptionSet, ["IsGlobal"]) ?? "false").toLowerCase() === "true",
        options: sorted(options, (option) => `${option.value}:${option.label}`),
        provenance,
        confidence: options.length > 0 ? 0.9 : 0.7
      };
      const duplicateOptionSet = optionSetMap.get(logicalName);

      if (!duplicateOptionSet) {
        optionSetMap.set(logicalName, parsedOptionSet);
      } else if (duplicateOptionSet.options.length !== parsedOptionSet.options.length) {
        warnings.push(
          conflictWarning(
            "DATAVERSE_OPTIONSET_CONFLICT",
            `Conflicting option set metadata detected for "${logicalName}".`,
            file.path,
            provenance
          )
        );
      } else {
        warnings.push(
          conflictWarning(
            "DATAVERSE_OPTIONSET_DUPLICATE",
            `Duplicate option set metadata detected for "${logicalName}".`,
            file.path,
            provenance
          )
        );
      }
    }

    const parsedEntity: DataverseEntity = {
      artifactId: entityArtifactId,
      logicalName: entityLogicalName,
      schemaName: entitySchemaName,
      displayName: entityDisplayName,
      ownershipType,
      primaryNameAttribute,
      primaryIdAttribute,
      attributes: sorted(
        Array.from(attributeMap.values()),
        (attribute) => attribute.logicalName
      ),
      provenance,
      confidence: clampConfidence(1 - warnings.length * 0.02)
    };
    const duplicateEntity = entityMap.get(entityLogicalName);

    if (!duplicateEntity) {
      entityMap.set(entityLogicalName, parsedEntity);
    } else if (
      duplicateEntity.schemaName !== parsedEntity.schemaName ||
      duplicateEntity.displayName !== parsedEntity.displayName
    ) {
      warnings.push(
        conflictWarning(
          "DATAVERSE_ENTITY_CONFLICT",
          `Conflicting entity metadata detected for "${entityLogicalName}".`,
          file.path,
          provenance
        )
      );
    } else {
      warnings.push(
        conflictWarning(
          "DATAVERSE_ENTITY_DUPLICATE",
          `Duplicate entity metadata detected for "${entityLogicalName}".`,
          file.path,
          provenance
        )
      );
    }
  }

  const entities = sorted(Array.from(entityMap.values()), (entity) => entity.logicalName);
  const relationships = sorted(
    Array.from(relationshipMap.values()),
    (relationship) => relationship.schemaName
  );
  const optionSets = sorted(
    Array.from(optionSetMap.values()),
    (optionSet) => optionSet.logicalName
  );
  const entityNames = new Set(entities.map((entity) => entity.logicalName));

  for (const relationship of relationships) {
    if (!entityNames.has(relationship.fromEntityLogicalName)) {
      warnings.push(
        createWarning({
          code: "DATAVERSE_RELATIONSHIP_UNRESOLVED_SOURCE_ENTITY",
          message: `Relationship source entity "${relationship.fromEntityLogicalName}" could not be resolved.`,
          sourceLocation: relationship.provenance.sourcePath,
          provenance: relationship.provenance,
          confidence: 0.95
        })
      );
    }

    if (!entityNames.has(relationship.toEntityLogicalName)) {
      warnings.push(
        createWarning({
          code: "DATAVERSE_RELATIONSHIP_UNRESOLVED_TARGET_ENTITY",
          message: `Relationship target entity "${relationship.toEntityLogicalName}" could not be resolved.`,
          sourceLocation: relationship.provenance.sourcePath,
          provenance: relationship.provenance,
          confidence: 0.95
        })
      );
    }
  }

  const total =
    entities.length + relationships.length + optionSets.length + warnings.length + unsupported.length;
  const confidence = total === 0 ? 1 : clampConfidence(1 - warnings.length / (total * 2));

  return {
    data: {
      entities,
      relationships,
      optionSets
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
