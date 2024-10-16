import { Interrupts } from "./interrupts";
import { toHexString } from "./utils";

export interface JoyPad {
  // 0xFF00
  getJOYP(): number;
  setJOYP(value: number): void;
  pressStartButton(): void;
  releaseStartButton(): void;
  pressSelectButton(): void;
  releaseSelectButton(): void;
  pressAButton(): void;
  releaseAButton(): void;
  pressBButton(): void;
  releaseBButton(): void;

  pressLeft(): void;
  releaseLeft(): void;
  pressRight(): void;
  releaseRight(): void;
  pressUp(): void;
  releaseUp(): void;
  pressDown(): void;
  releaseDown(): void;
}

export class JoyPadImpl implements JoyPad {
  // 0xFF
  private JOYP = 0xff;

  private buttons = 0xf;
  private pad = 0xf;

  constructor(private interrupts: Interrupts) {}

  getJOYP(): number {
    if ((this.JOYP & 0xf0) === 0b0001_0000) {
      return 0b1101_0000 | this.buttons;
    } else if ((this.JOYP & 0xf0) === 0b0010_0000) {
      return 0b1110_0000 | this.pad;
    } else {
      return 0xff;
    }
  }

  setJOYP(value: number): void {
    this.JOYP = (value & 0xf0) | (this.JOYP & 0x0f);
  }

  pressStartButton(): void {
    this.buttons = 0b0111;
  }

  releaseStartButton(): void {
    this.buttons = 0xf;
  }

  pressSelectButton(): void {
    this.buttons = 0b1011;
  }

  releaseSelectButton(): void {
    this.buttons = 0xf;
  }

  pressAButton(): void {
    this.buttons = 0b1110;
  }

  releaseAButton(): void {
    this.buttons = 0xf;
  }

  pressBButton(): void {
    this.buttons = 0b1101;
  }

  releaseBButton(): void {
    this.buttons = 0xf;
  }

  pressLeft(): void {
    this.pad = this.pad & 0b1101;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  releaseLeft(): void {
    this.pad = this.pad | 0b0010;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  pressRight(): void {
    this.pad = this.pad & 0b1110;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  releaseRight(): void {
    this.pad = this.pad | 0b0001;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  pressUp(): void {
    this.pad = this.pad & 0b1011;
  }

  releaseUp(): void {
    this.pad = this.pad | 0b0100;
  }

  pressDown(): void {
    this.pad = this.pad & 0b0111;
  }

  releaseDown(): void {
    this.pad = this.pad | 0b1000;
  }
}
