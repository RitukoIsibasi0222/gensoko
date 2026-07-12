export const STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES = [
  {
    name: 'ASCII',
    password72Bytes: `Aa1!${'a'.repeat(68)}`,
    password73Bytes: `Aa1!${'a'.repeat(69)}`
  },
  {
    name: '日本語',
    password72Bytes: `Aa1!${'あ'.repeat(22)}bc`,
    password73Bytes: `Aa1!${'あ'.repeat(22)}bcd`
  },
  {
    name: '絵文字',
    password72Bytes: `Aa1!${'😀'.repeat(16)}abcd`,
    password73Bytes: `Aa1!${'😀'.repeat(16)}abcde`
  },
  {
    name: '日本語・絵文字混在',
    password72Bytes: `Aa1!${'あ'.repeat(10)}${'😀'.repeat(8)}abcdef`,
    password73Bytes: `Aa1!${'あ'.repeat(10)}${'😀'.repeat(8)}abcdefg`
  }
] as const;

export const STRONG_PASSWORD_72_BYTES = STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES[3].password72Bytes;
export const STRONG_PASSWORD_73_BYTES = STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES[3].password73Bytes;

export function getUtf8ByteLengthForTest(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
