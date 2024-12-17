import { signedFrom8Bits, signedFrom11Bits, toBigEndian, toLittleEndian } from "../utils";

describe("utils", () => {
  it("converts to little endian", () => {
    const n = 0x12_34;
    const littleEndian = toLittleEndian(n);
    expect(littleEndian).toBe(0x34_12);
  });

  it("converts to big endian", () => {
    const n = 0x12_34;
    const bigEndian = toBigEndian(n);
    expect(bigEndian).toBe(0x34_12);
  });

  it("converts bits to signed number", () => {
    expect(signedFrom8Bits(0b0111_1111)).toBe(127);
    expect(signedFrom8Bits(0b0000_0001)).toBe(1);
    expect(signedFrom8Bits(0b0000_0000)).toBe(0);

    expect(signedFrom8Bits(0b1000_0000)).toBe(-128);
    expect(signedFrom8Bits(0b1000_0001)).toBe(-127);
    expect(signedFrom8Bits(0b1111_1111)).toBe(-1);
  });

  it("converts 11 bits to signed number", () => {
    expect(signedFrom11Bits(0b000_0000_0011)).toBe(3);
    // 0x500 = 0b10100000000 = -300
    expect(signedFrom11Bits(0b10100000000)).toBe(-768);
  });
});
