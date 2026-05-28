import path from "node:path";

import { sortByStableKey } from "@power-exit/ir";

export const toPosixRelativePath = (
  rootPath: string,
  absolutePath: string
): string => path.relative(rootPath, absolutePath).split(path.sep).join("/");

export const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

export const buildArtifactId = (prefix: string, value: string): string => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._:-]/g, "-");
  const trimmed = normalized.replace(/^-+|-+$/g, "");

  return `${prefix}:${trimmed || "unknown"}`;
};

export const sorted = <T>(
  values: readonly T[],
  selector: (value: T) => string
): T[] => sortByStableKey(values, selector);

export const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, value));

export const getNestedValue = (source: unknown, pathSegments: string[]): unknown => {
  let cursor: unknown = source;

  for (const segment of pathSegments) {
    if (cursor === null || typeof cursor !== "object") {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
};

export const getTextAt = (source: unknown, paths: string[]): string | undefined => {
  for (const pathValue of paths) {
    const nested = getNestedValue(source, pathValue.split("."));

    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested.trim();
    }

    if (typeof nested === "number" || typeof nested === "boolean") {
      return String(nested);
    }
  }

  return undefined;
};
