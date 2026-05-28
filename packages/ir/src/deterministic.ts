export const sortByStableKey = <T>(
  items: readonly T[],
  keySelector: (item: T) => string
): T[] =>
  items
    .map((item, index) => ({
      index,
      item,
      key: keySelector(item)
    }))
    .sort((left, right) => {
      if (left.key === right.key) {
        return left.index - right.index;
      }

      return left.key.localeCompare(right.key);
    })
    .map((entry) => entry.item);

const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
    );
  }

  return value;
};

export const stableStringify = (value: unknown): string =>
  JSON.stringify(normalizeValue(value));
