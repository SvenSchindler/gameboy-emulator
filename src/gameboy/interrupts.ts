import { toHexString } from "./utils";

export interface Interrupts {
  setInterruptFlag(value: number): void;
  getInterruptFlag(): number;
  setIE(value: number): void;
  getIE(): number;
  enableInterrupts(): void;
  isInterruptsEnabled(): boolean;
  disableInterrupts(): void;
}

export class InterruptsImpl implements Interrupts {
  // IF
  private interruptFlag = 0x00;

  // enable or disable global interrupt handling
  private ime = 0;

  // IE interrupt enable, defines what event to listen to
  private ie = 0;

  setInterruptFlag(value: number) {
    this.interruptFlag = value & 0xff;
  }

  getInterruptFlag() {
    return this.interruptFlag;
  }

  setIME(value: number) {
    this.ime = value & 0x1;
  }

  getIME() {
    return this.ime;
  }

  setIE(value: number) {
    this.ie = value & 0xff;
  }

  getIE() {
    return this.ie;
  }

  enableInterrupts() {
    this.setIME(1);
  }

  disableInterrupts() {
    this.setIME(0);
  }

  isInterruptsEnabled(): boolean {
    return this.getIME() === 1;
  }
}
