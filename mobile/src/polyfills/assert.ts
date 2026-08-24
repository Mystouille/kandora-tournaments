function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) {
    return true;
  }
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    return false;
  }
  return (
    actual.length === expected.length &&
    actual.every((value, index) => deepEqual(value, expected[index]))
  );
}

export function deepStrictEqual(actual: unknown, expected: unknown): void {
  if (!deepEqual(actual, expected)) {
    throw new Error("Values are not deeply equal");
  }
}

export default { deepStrictEqual };