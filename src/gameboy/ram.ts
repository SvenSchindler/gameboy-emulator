import { toHexString } from "./utils";

export interface Ram {
  readWorkingRam(address: number): number; // reads a single byte
  writeWorkingRam(address: number, value: number): void; // writes a single byte
  readHighRam(address: number): number; // reads a single byte
  writeHighRam(address: number, value: number): void; // writes a single byte
}

export class RamImpl implements Ram {
  // 0xC000 - 0xDFFF: Working RAM -> 8192 entries, 0 - 8191
  private workingRam: number[] = [];

  // 0xFF80 -	0xFFFE: High ram
  private highRam: number[] = [];

  readWorkingRam(address: number): number {
    if (address > 8191) {
      throw new Error("cannot read from working ram outside of address space" + address);
    }
    return this.workingRam[address] ?? 0;
  }

  writeWorkingRam(address: number, value: number) {
    if (address > 8191) {
      throw new Error("cannot write to working ram outside of address space" + address);
    }
    this.workingRam[address] = value & 0xff;
  }

  readHighRam(address: number): number {
    if (address > 126) {
      throw new Error("cannot read from high ram outside of address space" + address);
    }
    return this.highRam[address];
  }

  writeHighRam(address: number, value: number): void {
    if (address > 126) {
      throw new Error("cannot write to high ram outside of address space: " + toHexString(address));
    }
    this.highRam[address] = value;
  }
}
