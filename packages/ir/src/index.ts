export { artifactIdSchema, type ArtifactId } from "./artifact-id";
export { confidenceScoreSchema, type ConfidenceScore } from "./confidence";
export { sortByStableKey, stableStringify } from "./deterministic";
export {
  assertSchema,
  createEmptyPowerPlatformIR,
  mergeSolutionMetadataIntoIR,
  mergeParseResultIntoIR,
  serializeDeterministicIR,
  validatePowerPlatformIR
} from "./helpers";
export {
  createParseResultSchema,
  type ParseResult,
  unknownParseResultSchema
} from "./parse-result";
export {
  dataverseAttributeSchema,
  dataverseAttributeTypeSchema,
  dataverseEntitySchema,
  dataverseOptionSetSchema,
  dataverseRelationshipSchema,
  powerPlatformIRSchema,
  securityRoleSchema,
  solutionMetadataSchema,
  type ConnectionReference,
  type DataverseAttribute,
  type DataverseEntity,
  type DataverseOptionSet,
  type DataverseRelationship,
  type EnvironmentVariable,
  type PowerPlatformIR,
  type SecurityRole,
  type SolutionMetadata
} from "./power-platform-ir";
export {
  sourceProvenanceSchema,
  sourceTypeSchema,
  type SourceProvenance
} from "./provenance";
export {
  createUnsupportedFeature,
  type CreateUnsupportedFeatureInput,
  unsupportedFeatureSchema,
  unsupportedFeatureSeveritySchema,
  type UnsupportedFeature
} from "./unsupported-feature";
export {
  createWarning,
  parserWarningSchema,
  parserWarningSeveritySchema,
  type CreateWarningInput,
  type ParserWarning
} from "./warnings";
