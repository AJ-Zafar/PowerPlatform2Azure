import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_ROOT = path.resolve(__dirname, "..", "samples");

const toSafeRelativePath = (fixturePath: string): string => {
  const normalized = path.normalize(fixturePath);

  if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`Fixture path must be relative to samples/: ${fixturePath}`);
  }

  return normalized;
};

export const loadFixtureText = async (fixturePath: string): Promise<string> => {
  const safeRelativePath = toSafeRelativePath(fixturePath);
  const absolutePath = path.join(FIXTURE_ROOT, safeRelativePath);

  return readFile(absolutePath, "utf-8");
};
