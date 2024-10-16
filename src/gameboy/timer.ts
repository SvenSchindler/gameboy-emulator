import { Interrupts } from "./interrupts";

export interface Timer {
  getTimerDiv(): number;
  setTimerModulo(value: number): void;
  setTimerCounter(value: number): void;
  getTimerCounter(): number;
  tick(): void;
  setTAC(value: number): void;
}

export class TimerImpl implements Timer {
  // This 8 bit register is incremented at a rate of 16384Hz. This means it's updated every
  // 256 tcycles. Internally, we still have to be able to update our timer values every 4
  // m cycles, so every 16 t cycles. We'll use a small modulo helper to achieve this.
  // FF04
  private DIV = 0x00;

  private divModulo = 0;

  // FF05: TIMA TimerCounter
  private TIMA = 0;

  // FF06: timer modulo, TMA
  private TMA = 0;

  // FF07: TAC
  private TAC: number = 0;

  constructor(private interrupts: Interrupts) {}

  setTimerModulo(value: number): void {
    this.TMA = value & 0xff;
  }

  setTAC(value: number) {
    this.TAC = value & 0xff;
  }

  getTimerDiv(): number {
    return this.DIV;
  }

  setTimerCounter(value: number): void {
    this.TIMA = value & 0xff;
  }

  getTimerCounter(): number {
    return this.TIMA;
  }

  // Called at every t cycle.
  tick(): void {
    let updateTimer = false;
    const clockSelect = this.TAC & 0b11;

    if (clockSelect === 0) {
      // update every 256 m cycles => every 1024 t cycles
      if (this.DIV % 4 === 0 && this.divModulo === 0) {
        updateTimer = true;
      }
    } else if (clockSelect === 1) {
      // every 4 m cycles => every 16 tcycles
      if (this.divModulo % 16 === 0) {
        updateTimer = true;
      }
    } else if (clockSelect === 2) {
      // every 16 m cycles => every 64 tcycles
      if (this.divModulo % 64 === 0) {
        updateTimer = true;
      }
    } else if (clockSelect === 3) {
      // every 64 m cycles => every 256 tcycles
      if (this.divModulo === 255) {
        updateTimer = true;
      }
    }

    const timerEnabled = this.TAC >> 2 === 1;
    if (timerEnabled && updateTimer) {
      this.TIMA = this.TIMA + 1;
      if (this.TIMA > 0xff) {
        this.TIMA = this.TMA;
        // Throw a timer interrupt
        const activeInterrupts = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(activeInterrupts | 0b100);
      }
    }

    // increment our timer
    if (this.divModulo === 255) {
      this.DIV = (this.DIV + 1) & 0xff;
      this.divModulo = 0;
    } else {
      this.divModulo++;
    }
  }
}
