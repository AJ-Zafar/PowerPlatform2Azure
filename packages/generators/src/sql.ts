import { z } from "zod";

import {
  sortByStableKey,
  validatePowerPlatformIR,
  type DataverseAttribute,
  type DataverseEntity,
  type DataverseRelationship,
  type PowerPlatformIR
} from "@power-exit/ir";

import {
  createGenerationResultSchema,
  type GenerationResult,
  type GenerationUnsupportedFeature,
  type GenerationWarning,
  type GeneratorContext
} from "./contracts";

const dataverseSqlGenerationOutputSchema = z
  .object({
    tablesGenerated: z.number().int().nonnegative(),
    columnsGenerated: z.number().int().nonnegative(),
    relationshipsGenerated: z.number().int().nonnegative()
  })
  .strict();

export type DataverseSqlGenerationOutput = z.infer<typeof dataverseSqlGenerationOutputSchema>;

type DataverseSection = PowerPlatformIR["dataverse"];

interface EntitySqlModel {
  entity: DataverseEntity;
  tableName: string;
  primaryKeyColumnName: string;
  columnNameByAttributeId: Map<string, string>;
  sourceArtifactIds: string[];
}

const defaultContext = (): GeneratorContext => ({
  invocationProvenance: {
    sourcePath: "generators/sql",
    sourceType: "generator"
  }
});

const sanitizeSqlIdentifier = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "unnamed";
  }

  if (/^[0-9]/.test(normalized)) {
    return `n_${normalized}`;
  }

  return normalized;
};

const confidenceFromIssues = (warningCount: number, unsupportedCount: number): number =>
  Math.max(0, Math.min(1, 1 - warningCount * 0.02 - unsupportedCount * 0.05));

const createGenerationWarning = (
  input: Omit<GenerationWarning, "severity" | "confidence">
): GenerationWarning => ({
  severity: "warning",
  confidence: 0.85,
  ...input
});

const createGenerationUnsupportedFeature = (
  input: Omit<GenerationUnsupportedFeature, "confidence">
): GenerationUnsupportedFeature => ({
  confidence: 0.9,
  ...input
});

const ensureUniqueSqlIdentifier = (
  preferred: string,
  usedNames: Set<string>,
  onCollision: (resolvedName: string, preferredName: string) => void
): string => {
  let candidate = preferred;
  let suffix = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${preferred}_${suffix}`;
    suffix += 1;
  }

  if (candidate !== preferred) {
    onCollision(candidate, preferred);
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
};

const addNameCollisionWarning = (
  warnings: GenerationWarning[],
  context: GeneratorContext,
  sourceArtifactIds: string[],
  preferredName: string,
  resolvedName: string
): void => {
  warnings.push(
    createGenerationWarning({
      code: "SQL_NAME_COLLISION",
      message: `SQL identifier "${preferredName}" collided and was renamed to "${resolvedName}".`,
      sourceArtifactIds,
      sourceLocation: context.invocationProvenance.sourcePath,
      provenance: context.invocationProvenance
    })
  );
};

const unsupportedFeatureByAttribute = (
  attribute: DataverseAttribute
): { featureType: string; reason: string; remediation: string } | undefined => {
  const normalizedName = `${attribute.logicalName}.${attribute.schemaName}`.toLowerCase();

  if (attribute.type === "customer") {
    return {
      featureType: "dataverse.polymorphic-lookup.customer",
      reason: "Customer/polymorphic lookup columns require manual relationship modeling.",
      remediation:
        "Model customer lookup targets explicitly in SQL and migration logic before cutover."
    };
  }

  if (attribute.type !== "unknown") {
    return undefined;
  }

  if (normalizedName.includes("calculated")) {
    return {
      featureType: "dataverse.column.calculated",
      reason: "Calculated columns are not directly expressible in static SQL DDL.",
      remediation:
        "Recreate calculated behavior using computed columns, views, or data pipelines after migration."
    };
  }

  if (normalizedName.includes("rollup")) {
    return {
      featureType: "dataverse.column.rollup",
      reason: "Rollup columns require aggregation logic beyond schema generation.",
      remediation:
        "Implement rollup calculations via ETL jobs, SQL views, or scheduled recomputation."
    };
  }

  if (normalizedName.includes("file")) {
    return {
      featureType: "dataverse.column.file",
      reason: "File columns need external storage and metadata modeling.",
      remediation:
        "Store files in Blob storage and keep references in SQL before enabling write paths."
    };
  }

  if (normalizedName.includes("image")) {
    return {
      featureType: "dataverse.column.image",
      reason: "Image columns need binary/object storage handling outside basic DDL generation.",
      remediation:
        "Store image assets externally and persist metadata plus object references in SQL."
    };
  }

  if (normalizedName.includes("partylist") || normalizedName.includes("activityparty")) {
    return {
      featureType: "dataverse.column.activityparty",
      reason: "Party list/activity party relationships are polymorphic and high-complexity.",
      remediation:
        "Model party list entities manually using association tables and explicit type discriminators."
    };
  }

  return {
    featureType: "dataverse.column.unknown",
    reason: "Unknown Dataverse column type mapped using a fallback SQL type.",
    remediation:
      "Confirm source column semantics and replace fallback SQL type with a domain-appropriate mapping."
  };
};

const sqlTypeForAttribute = (
  attribute: DataverseAttribute
): { sqlType: string; nullable: boolean } => {
  const nullable =
    attribute.requiredLevel !== "applicationRequired" &&
    attribute.requiredLevel !== "systemRequired";

  switch (attribute.type) {
    case "string":
      return {
        sqlType: `NVARCHAR(${attribute.maxLength ?? 255})`,
        nullable
      };
    case "memo":
      return {
        sqlType: "NVARCHAR(MAX)",
        nullable
      };
    case "integer":
      return {
        sqlType: "INT",
        nullable
      };
    case "bigint":
      return {
        sqlType: "BIGINT",
        nullable
      };
    case "decimal":
      return {
        sqlType: `DECIMAL(${attribute.precision ?? 18},${attribute.scale ?? 2})`,
        nullable
      };
    case "float":
      return {
        sqlType: "FLOAT",
        nullable
      };
    case "money":
      return {
        sqlType: "DECIMAL(19,4)",
        nullable
      };
    case "boolean":
      return {
        sqlType: "BIT",
        nullable
      };
    case "datetime":
      return {
        sqlType: "DATETIME2",
        nullable
      };
    case "date":
      return {
        sqlType: "DATE",
        nullable
      };
    case "lookup":
    case "owner":
    case "customer":
      return {
        sqlType: "UNIQUEIDENTIFIER",
        nullable
      };
    case "picklist":
    case "state":
    case "status":
      return {
        sqlType: "INT",
        nullable
      };
    case "multiselectpicklist":
      return {
        sqlType: "NVARCHAR(MAX)",
        nullable
      };
    case "uniqueidentifier":
      return {
        sqlType: "UNIQUEIDENTIFIER",
        nullable
      };
    case "unknown":
    default:
      return {
        sqlType: "NVARCHAR(MAX)",
        nullable
      };
  }
};

const uniqueSortedArtifactIds = (artifactIds: Iterable<string>): string[] =>
  sortByStableKey(Array.from(new Set(artifactIds)), (artifactId) => artifactId);

const findRelationshipLookupAttribute = (
  relationship: DataverseRelationship,
  sourceEntity: DataverseEntity
): DataverseAttribute | undefined => {
  const candidates = sourceEntity.attributes.filter((attribute) =>
    ["lookup", "owner", "customer"].includes(attribute.type)
  );
  const normalizedTargetName = sanitizeSqlIdentifier(relationship.toEntityLogicalName);

  const exactMatch = candidates.find(
    (attribute) =>
      sanitizeSqlIdentifier(attribute.logicalName) === `${normalizedTargetName}id`
  );

  if (exactMatch) {
    return exactMatch;
  }

  return sortByStableKey(candidates, (attribute) => attribute.logicalName).find((attribute) =>
    sanitizeSqlIdentifier(attribute.logicalName).includes(normalizedTargetName)
  );
};

const buildGenerationReportMarkdown = (
  output: DataverseSqlGenerationOutput,
  warnings: GenerationWarning[],
  unsupportedFeatures: GenerationUnsupportedFeature[],
  mappings: Array<{ logicalName: string; sqlName: string; kind: "table" | "column" }>
): string => {
  const lines: string[] = [];
  lines.push("# Power Exit SQL Generation Report");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Tables generated: ${output.tablesGenerated}`);
  lines.push(`- Columns generated: ${output.columnsGenerated}`);
  lines.push(`- Relationships generated: ${output.relationshipsGenerated}`);
  lines.push(`- Warnings: ${warnings.length}`);
  lines.push(`- Unsupported features: ${unsupportedFeatures.length}`);
  lines.push("");
  lines.push("## Dataverse to SQL name mappings");
  lines.push("");

  for (const mapping of sortByStableKey(
    mappings,
    (entry) => `${entry.kind}:${entry.logicalName}:${entry.sqlName}`
  )) {
    lines.push(`- ${mapping.kind}: \`${mapping.logicalName}\` -> \`${mapping.sqlName}\``);
  }

  lines.push("");
  lines.push("## Warnings");
  lines.push("");

  if (warnings.length === 0) {
    lines.push("- None.");
  } else {
    for (const warning of sortByStableKey(warnings, (warning) => `${warning.code}:${warning.message}`)) {
      lines.push(`- [${warning.code}] ${warning.message}`);
    }
  }

  lines.push("");
  lines.push("## Unsupported features");
  lines.push("");

  if (unsupportedFeatures.length === 0) {
    lines.push("- None.");
  } else {
    for (const unsupportedFeature of sortByStableKey(
      unsupportedFeatures,
      (feature) => `${feature.severity}:${feature.featureType}`
    )) {
      lines.push(
        `- [${unsupportedFeature.severity}] ${unsupportedFeature.featureType}: ${unsupportedFeature.reason}`
      );
    }
  }

  lines.push("");
  lines.push(
    "Generated SQL is a migration starting point and should be reviewed before production deployment."
  );

  return lines.join("\n");
};

export const generateDataverseSqlArtifacts = async (
  dataverse: DataverseSection,
  contextInput?: GeneratorContext
): Promise<GenerationResult<DataverseSqlGenerationOutput>> => {
  const context = contextInput ?? defaultContext();
  const warnings: GenerationWarning[] = [];
  const unsupportedFeatures: GenerationUnsupportedFeature[] = [];
  const mappings: Array<{ logicalName: string; sqlName: string; kind: "table" | "column" }> = [];

  const sortedEntities = sortByStableKey(dataverse.entities, (entity) => entity.logicalName);
  const sortedRelationships = sortByStableKey(
    dataverse.relationships,
    (relationship) => relationship.schemaName
  );
  const tableNames = new Set<string>();
  const entitySqlModels = new Map<string, EntitySqlModel>();
  const relationshipConstraintNames = new Set<string>();
  const schemaSections: string[] = [];
  let columnCount = 0;
  let relationshipCount = 0;

  for (const entity of sortedEntities) {
    if (entity.ownershipType.toLowerCase().includes("virtual")) {
      unsupportedFeatures.push(
        createGenerationUnsupportedFeature({
          featureType: "dataverse.entity.virtual-table",
          sourceLocation: entity.provenance.sourcePath,
          reason: `Entity "${entity.logicalName}" appears to be virtual and may require external data virtualization.`,
          suggestedRemediation:
            "Model virtual table backing store and synchronization strategy before migration.",
          severity: "high",
          sourceArtifactIds: [entity.artifactId],
          provenance: entity.provenance
        })
      );
    }

    const preferredTableName = sanitizeSqlIdentifier(entity.logicalName);
    const tableName = ensureUniqueSqlIdentifier(preferredTableName, tableNames, (resolvedName) => {
      addNameCollisionWarning(
        warnings,
        context,
        [entity.artifactId],
        preferredTableName,
        resolvedName
      );
    });

    mappings.push({
      logicalName: entity.logicalName,
      sqlName: tableName,
      kind: "table"
    });

    const columnsInEntity = new Set<string>();
    const columnNameByAttributeId = new Map<string, string>();
    const sortedAttributes = sortByStableKey(entity.attributes, (attribute) => attribute.logicalName);
    const primaryIdAttribute =
      sortedAttributes.find(
        (attribute) =>
          sanitizeSqlIdentifier(attribute.logicalName) ===
          sanitizeSqlIdentifier(entity.primaryIdAttribute)
      ) ??
      sortedAttributes.find((attribute) => attribute.type === "uniqueidentifier");

    const orderedAttributes = primaryIdAttribute
      ? [primaryIdAttribute, ...sortedAttributes.filter((attribute) => attribute !== primaryIdAttribute)]
      : sortedAttributes;
    const tableDefinitionLines: string[] = [];

    tableDefinitionLines.push(`-- Dataverse entity "${entity.logicalName}" -> SQL table "${tableName}"`);
    tableDefinitionLines.push(`CREATE TABLE [dbo].[${tableName}] (`);

    let resolvedPrimaryKeyColumn: string | undefined;

    for (const attribute of orderedAttributes) {
      const preferredColumnName = sanitizeSqlIdentifier(attribute.logicalName);
      const columnName = ensureUniqueSqlIdentifier(preferredColumnName, columnsInEntity, (resolvedName) => {
        addNameCollisionWarning(
          warnings,
          context,
          [entity.artifactId, attribute.artifactId],
          preferredColumnName,
          resolvedName
        );
      });
      const isPrimary = sanitizeSqlIdentifier(attribute.logicalName) === sanitizeSqlIdentifier(entity.primaryIdAttribute);
      const columnType = sqlTypeForAttribute(attribute);
      const nullable = isPrimary ? false : columnType.nullable;
      const unsupportedFeature = unsupportedFeatureByAttribute(attribute);

      if (unsupportedFeature) {
        warnings.push(
          createGenerationWarning({
            code: "SQL_UNSUPPORTED_COLUMN",
            message: `Column "${attribute.logicalName}" is mapped with limitations (${unsupportedFeature.featureType}).`,
            sourceArtifactIds: [entity.artifactId, attribute.artifactId],
            sourceLocation: attribute.provenance.sourcePath,
            provenance: attribute.provenance
          })
        );
        unsupportedFeatures.push(
          createGenerationUnsupportedFeature({
            featureType: unsupportedFeature.featureType,
            sourceLocation: attribute.provenance.sourcePath,
            reason: unsupportedFeature.reason,
            suggestedRemediation: unsupportedFeature.remediation,
            severity: attribute.type === "customer" ? "high" : "medium",
            sourceArtifactIds: [entity.artifactId, attribute.artifactId],
            provenance: attribute.provenance
          })
        );
      }

      if (["picklist", "state", "status"].includes(attribute.type)) {
        const optionSet = dataverse.optionSets.find(
          (item) =>
            sanitizeSqlIdentifier(item.logicalName) ===
              sanitizeSqlIdentifier(`${entity.logicalName}_${attribute.logicalName}`) ||
            sanitizeSqlIdentifier(item.logicalName) === sanitizeSqlIdentifier(attribute.logicalName)
        );

        if (optionSet) {
          tableDefinitionLines.push(
            `  -- Choice mapping ${optionSet.logicalName} (${optionSet.options.length} options)`
          );
        }
      }

      tableDefinitionLines.push(
        `  [${columnName}] ${columnType.sqlType} ${nullable ? "NULL" : "NOT NULL"},`
      );

      mappings.push({
        logicalName: `${entity.logicalName}.${attribute.logicalName}`,
        sqlName: `${tableName}.${columnName}`,
        kind: "column"
      });
      columnNameByAttributeId.set(attribute.artifactId, columnName);
      columnCount += 1;

      if (isPrimary) {
        resolvedPrimaryKeyColumn = columnName;
      }
    }

    if (!resolvedPrimaryKeyColumn) {
      resolvedPrimaryKeyColumn = ensureUniqueSqlIdentifier(
        sanitizeSqlIdentifier(entity.primaryIdAttribute),
        columnsInEntity,
        () => undefined
      );
      tableDefinitionLines.push(
        `  [${resolvedPrimaryKeyColumn}] UNIQUEIDENTIFIER NOT NULL,`
      );
      mappings.push({
        logicalName: `${entity.logicalName}.${entity.primaryIdAttribute}`,
        sqlName: `${tableName}.${resolvedPrimaryKeyColumn}`,
        kind: "column"
      });
      columnCount += 1;
      warnings.push(
        createGenerationWarning({
          code: "SQL_PRIMARY_KEY_SYNTHESIZED",
          message: `Entity "${entity.logicalName}" did not include an explicit primary key attribute; generated "${resolvedPrimaryKeyColumn}".`,
          sourceArtifactIds: [entity.artifactId],
          sourceLocation: entity.provenance.sourcePath,
          provenance: entity.provenance
        })
      );
    }

    const primaryConstraintName = `pk_${tableName}`;
    tableDefinitionLines.push(
      `  CONSTRAINT [${primaryConstraintName}] PRIMARY KEY ([${resolvedPrimaryKeyColumn}])`
    );
    tableDefinitionLines.push(");");
    schemaSections.push(tableDefinitionLines.join("\n"));

    entitySqlModels.set(entity.logicalName, {
      entity,
      tableName,
      primaryKeyColumnName: resolvedPrimaryKeyColumn,
      columnNameByAttributeId,
      sourceArtifactIds: [entity.artifactId, ...entity.attributes.map((attribute) => attribute.artifactId)]
    });
  }

  const relationshipStatements: string[] = [];

  for (const relationship of sortedRelationships) {
    const source = entitySqlModels.get(relationship.fromEntityLogicalName);
    const target = entitySqlModels.get(relationship.toEntityLogicalName);

    if (!source || !target) {
      warnings.push(
        createGenerationWarning({
          code: "SQL_RELATIONSHIP_UNRESOLVED",
          message: `Relationship "${relationship.schemaName}" could not be resolved because source/target entities are missing.`,
          sourceArtifactIds: [relationship.artifactId],
          sourceLocation: relationship.provenance.sourcePath,
          provenance: relationship.provenance
        })
      );
      continue;
    }

    if (relationship.relationshipType === "many-to-many") {
      const joinTableName = ensureUniqueSqlIdentifier(
        `${sanitizeSqlIdentifier(relationship.schemaName)}_join`,
        tableNames,
        (resolvedName, preferredName) => {
          addNameCollisionWarning(
            warnings,
            context,
            [relationship.artifactId],
            preferredName,
            resolvedName
          );
        }
      );
      const leftColumn = sanitizeSqlIdentifier(source.entity.primaryIdAttribute);
      const rightColumn = sanitizeSqlIdentifier(target.entity.primaryIdAttribute);
      const pkConstraintName = `pk_${joinTableName}`;
      const fkLeftName = ensureUniqueSqlIdentifier(
        `fk_${joinTableName}_${source.tableName}`,
        relationshipConstraintNames,
        () => undefined
      );
      const fkRightName = ensureUniqueSqlIdentifier(
        `fk_${joinTableName}_${target.tableName}`,
        relationshipConstraintNames,
        () => undefined
      );

      relationshipStatements.push(
        [
          `-- Dataverse relationship "${relationship.schemaName}" (many-to-many join table)`,
          `CREATE TABLE [dbo].[${joinTableName}] (`,
          `  [${leftColumn}] UNIQUEIDENTIFIER NOT NULL,`,
          `  [${rightColumn}] UNIQUEIDENTIFIER NOT NULL,`,
          `  CONSTRAINT [${pkConstraintName}] PRIMARY KEY ([${leftColumn}], [${rightColumn}])`,
          ");",
          `ALTER TABLE [dbo].[${joinTableName}] ADD CONSTRAINT [${fkLeftName}] FOREIGN KEY ([${leftColumn}]) REFERENCES [dbo].[${source.tableName}]([${source.primaryKeyColumnName}]);`,
          `ALTER TABLE [dbo].[${joinTableName}] ADD CONSTRAINT [${fkRightName}] FOREIGN KEY ([${rightColumn}]) REFERENCES [dbo].[${target.tableName}]([${target.primaryKeyColumnName}]);`
        ].join("\n")
      );
      relationshipCount += 1;
      continue;
    }

    const lookupAttribute = findRelationshipLookupAttribute(relationship, source.entity);

    if (!lookupAttribute) {
      warnings.push(
        createGenerationWarning({
          code: "SQL_RELATIONSHIP_UNRESOLVED",
          message: `Relationship "${relationship.schemaName}" has no confidently resolvable lookup column in "${source.entity.logicalName}".`,
          sourceArtifactIds: [relationship.artifactId, source.entity.artifactId, target.entity.artifactId],
          sourceLocation: relationship.provenance.sourcePath,
          provenance: relationship.provenance
        })
      );
      continue;
    }

    const sourceColumnName = source.columnNameByAttributeId.get(lookupAttribute.artifactId);

    if (!sourceColumnName) {
      warnings.push(
        createGenerationWarning({
          code: "SQL_RELATIONSHIP_UNRESOLVED",
          message: `Relationship "${relationship.schemaName}" lookup attribute mapping is unavailable for SQL generation.`,
          sourceArtifactIds: [relationship.artifactId, lookupAttribute.artifactId],
          sourceLocation: relationship.provenance.sourcePath,
          provenance: relationship.provenance
        })
      );
      continue;
    }

    if (lookupAttribute.type === "customer") {
      unsupportedFeatures.push(
        createGenerationUnsupportedFeature({
          featureType: "dataverse.relationship.polymorphic-lookup",
          sourceLocation: relationship.provenance.sourcePath,
          reason: `Relationship "${relationship.schemaName}" depends on customer/polymorphic lookup behavior.`,
          suggestedRemediation:
            "Model polymorphic references as explicit association tables before enforcing foreign keys.",
          severity: "high",
          sourceArtifactIds: [relationship.artifactId, lookupAttribute.artifactId],
          provenance: relationship.provenance
        })
      );
      warnings.push(
        createGenerationWarning({
          code: "SQL_RELATIONSHIP_POLYMORPHIC_LOOKUP",
          message: `Relationship "${relationship.schemaName}" uses polymorphic lookup and requires manual review.`,
          sourceArtifactIds: [relationship.artifactId, lookupAttribute.artifactId],
          sourceLocation: relationship.provenance.sourcePath,
          provenance: relationship.provenance
        })
      );
    }

    const constraintName = ensureUniqueSqlIdentifier(
      `fk_${source.tableName}_${target.tableName}_${sourceColumnName}`,
      relationshipConstraintNames,
      () => undefined
    );

    relationshipStatements.push(
      [
        `-- Dataverse relationship "${relationship.schemaName}"`,
        `ALTER TABLE [dbo].[${source.tableName}] ADD CONSTRAINT [${constraintName}] FOREIGN KEY ([${sourceColumnName}]) REFERENCES [dbo].[${target.tableName}]([${target.primaryKeyColumnName}]);`
      ].join("\n")
    );
    relationshipCount += 1;
  }

  const schemaContent = [
    "-- Power Exit Dataverse -> Azure SQL DDL",
    "-- Generated deterministically from validated PowerPlatformIR dataverse section.",
    ...schemaSections,
    ...relationshipStatements
  ].join("\n\n");
  const output: DataverseSqlGenerationOutput = {
    tablesGenerated: schemaSections.length + relationshipStatements.filter((item) => item.includes("CREATE TABLE")).length,
    columnsGenerated: columnCount,
    relationshipsGenerated: relationshipCount
  };
  const reportContent = buildGenerationReportMarkdown(output, warnings, unsupportedFeatures, mappings);
  const sourceArtifactIds = uniqueSortedArtifactIds([
    ...sortedEntities.map((entity) => entity.artifactId),
    ...sortedEntities.flatMap((entity) => entity.attributes.map((attribute) => attribute.artifactId)),
    ...sortedRelationships.map((relationship) => relationship.artifactId)
  ]);
  const confidence = confidenceFromIssues(warnings.length, unsupportedFeatures.length);
  const parsedResult = createGenerationResultSchema(dataverseSqlGenerationOutputSchema).parse({
    artifacts: sortByStableKey(
      [
        {
          artifactId: "generated:schema-sql",
          artifactType: "sql-schema",
          filePath: "schema.sql",
          content: schemaContent,
          sourceArtifactIds,
          warnings: warnings,
          provenance: context.invocationProvenance,
          confidence
        },
        {
          artifactId: "generated:sql-generation-report",
          artifactType: "markdown-report",
          filePath: "generation-report.md",
          content: reportContent,
          sourceArtifactIds,
          warnings: warnings,
          provenance: context.invocationProvenance,
          confidence
        }
      ],
      (artifact) => artifact.filePath
    ),
    output,
    warnings,
    unsupportedFeatures,
    confidence,
    provenance: context.invocationProvenance
  });

  return parsedResult as GenerationResult<DataverseSqlGenerationOutput>;
};

export const generateDataverseSqlFromPowerPlatformIR = async (
  input: unknown,
  contextInput?: GeneratorContext
): Promise<GenerationResult<DataverseSqlGenerationOutput>> => {
  const validatedIr = validatePowerPlatformIR(input);
  const context = contextInput ?? defaultContext();

  return generateDataverseSqlArtifacts(validatedIr.dataverse, context);
};
