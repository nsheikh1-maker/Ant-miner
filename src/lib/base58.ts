const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = new Map([...ALPHABET].map((char, index) => [char, BigInt(index)]));

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let body = "";
  while (value > 0n) {
    body = ALPHABET[Number(value % 58n)] + body;
    value /= 58n;
  }
  return "1".repeat(zeros) + body;
}

export function decodeBase58(input: string): Uint8Array | null {
  if (input.length < 1 || input.length > 100) return null;
  let value = 0n;
  for (const char of input) {
    const digit = MAP.get(char);
    if (digit === undefined) return null;
    value = value * 58n + digit;
  }
  let zeros = 0;
  for (const char of input) {
    if (char === "1") zeros += 1;
    else break;
  }
  const body: number[] = [];
  while (value > 0n) {
    body.push(Number(value & 0xffn));
    value >>= 8n;
  }
  const out = new Uint8Array(zeros + body.length);
  for (let i = 0; i < body.length; i += 1) out[out.length - 1 - i] = body[i];
  return out;
}

export function isSolanaAddress(value: string): boolean {
  const bytes = decodeBase58(value.trim());
  if (!bytes || bytes.length !== 32) return false;
  return bytes.some((byte) => byte !== 0);
}

export function isSolanaSignature(value: string): boolean {
  const bytes = decodeBase58(value.trim());
  return !!bytes && bytes.length === 64;
}
