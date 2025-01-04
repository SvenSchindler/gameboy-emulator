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
  private JOYP = 0xff;

  private buttons = 0xf;
  private pad = 0xf;

  constructor(private interrupts: Interrupts) {}

  getJOYP(): number {
    if ((this.JOYP & 0b0010_0000) === 0x0) {
      return (this.JOYP & 0xf0) | this.buttons;
    } else if ((this.JOYP & 0b0001_0000) === 0) {
      return (this.JOYP & 0xf0) | this.pad;
    } else {
      return (this.JOYP & 0b1111_0000) | 0xf;
    }
  }

  setJOYP(value: number): void {
    this.JOYP = (value & 0xf0) | (this.JOYP & 0x0f);
  }

  pressStartButton(): void {
    this.buttons = this.buttons & 0b0111;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  releaseStartButton(): void {
    this.buttons = this.buttons | 0b1000;
  }

  pressSelectButton(): void {
    this.buttons = this.buttons & 0b1011;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  releaseSelectButton(): void {
    this.buttons = this.buttons | 0b0100;
  }

  pressAButton(): void {
    this.buttons = this.buttons & 0b1110;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  releaseAButton(): void {
    this.buttons = this.buttons | 0b0001;
  }

  pressBButton(): void {
    this.buttons = this.buttons & 0b1101;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10000);
  }

  releaseBButton(): void {
    this.buttons = this.buttons | 0b0010;
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
