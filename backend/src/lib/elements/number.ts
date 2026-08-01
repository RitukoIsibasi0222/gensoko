const DECIMAL_INTEGER_PATTERN = /^\d+$/;

export function isDecimalIntegerString(value: string): boolean {
  return DECIMAL_INTEGER_PATTERN.test(value);
}
