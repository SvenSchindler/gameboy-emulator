export function toHexString(n: number, bits: number = 8) {
  const digits = bits / 4; // one character for each nibble
  return "0x" + n.toString(16).padStart(digits, "0").toUpperCase();
}

// The endian conversion functions do pretty much the same but
// I think the names make a bit clearer whats happening.

// Works for 2 bytes only!
export function toLittleEndian(bigEndian: number) {
  const low = bigEndian & 0xff;
  const high = bigEndian & 0xff00;
  return (low << 8) + (high >> 8);
}

// Works for 2 bytes only!
export function toBigEndian(littleEndian: number) {
  const low = littleEndian & 0xff00;
  const high = littleEndian & 0xff;
  return (high << 8) + (low >> 8);
}

export function signedFrom8Bits(bits: number) {
  const isNegative = (bits & 0x80) === 0x80;
  if (isNegative) {
    return -((~bits + 1) & 0xff);
  } else {
    return bits;
  }
}

export function signedFrom11Bits(bits: number) {
  const isNegative = bits >> 10 === 0x1;
  if (isNegative) {
    return -((~bits + 1) & 0b11_1111_1111);
  } else {
    return bits;
  }
}

export function assertExists<T>(value: T | null | undefined, msg: string): T {
  if (value) {
    return value;
  } else {
    throw Error(msg);
  }
}
