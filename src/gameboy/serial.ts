import { Interrupts } from "./interrupts";

export interface Serial {
  writeSB(value: number): void;
  readSB(): number;
  writeSC(value: number): void;
  readSC(): number;
  tick(): void;
}

export class SerialImpl implements Serial {
  private SB = 0xff;
  private SC = 0x00;

  private dataAsText: string = "";

  // Just a mock counter thats set to 8 once we want to transfer data
  private tickCounter = 0;

  constructor(private interrupts: Interrupts) {}

  writeSB(value: number): void {
    this.SB = value;
    // this.dataAsText = this.dataAsText + String.fromCharCode(value & 0xff);
    // Use this for debugging serial output
    // console.log('serial output: ' + this.dataAsText);
  }

  readSB(): number {
    return this.SB;
  }

  writeSC(value: number): void {
    this.SC = value;
    if (this.tickCounter > 0) {
      return;
    }
    // In this mock serial implementation we're not really transferring anything
    // but we'll still shift data into sb.
    // 0x81, tranfer requested + we are the clock.
    if (this.SC === 0x81) {
      this.tickCounter = 8;
    }
  }

  readSC(): number {
    return this.SC;
  }

  tick(): void {
    if (this.tickCounter > 0) {
      this.SB = ((this.SB << 1) | 1) & 0xff;
      this.tickCounter--;
      if (this.tickCounter === 0) {
        this.SC = this.SC & 0b0111_1111;
        const currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 0b1000);
      }
    }
  }
}
