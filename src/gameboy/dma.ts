import { Bus } from "./bus";
import { PPU } from "./ppu";

export interface DMA {
  tick(): void;
  writeFF46(address: number): void;
  isTransferring(): boolean;
}

export class DMAImpl implements DMA {
  private active = false;
  private bytesTransferred = 0;
  private startAddress = 0;

  constructor(
    private bus: Bus,
    private ppu: PPU,
  ) {}

  tick(): void {
    if (!this.active) {
      return;
    }

    this.ppu.writeOAM(this.bytesTransferred, this.bus!.read(this.startAddress * 0x100 + this.bytesTransferred));

    this.bytesTransferred++;
    if (this.bytesTransferred >= 0xa0) {
      this.active = false;
    }
  }

  writeFF46(address: number): void {
    this.bytesTransferred = 0;
    this.active = true;
    this.startAddress = address;
  }

  isTransferring(): boolean {
    return this.active;
  }
}
