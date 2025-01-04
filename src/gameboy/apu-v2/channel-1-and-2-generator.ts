import { EnvelopeDirection } from "./apu-utils";

export type SweepOptions = { sweepPace: number; sweepDirection: SweepDirection; sweepIndividualStep: number };

export type SweepDirection = "UP" | "DOWN";

export class Channel1And2SampleGenerator {
  private channelEnabled = false;

  // Value between 0 and 15
  private volume = 0;

  // Turns of channel once it hits 64
  private lengthEnabled = false;
  private initialLength = 0;

  private period = 0;
  private periodUpCounter = 0;

  // period divider up counter clocked at 1048576, every 4 dots
  private periodTickCounter = 0;
  private periodClockTickModulo = 4;

  // length timer increased at 256hz, that's every 16384 ticks
  private lengthTickCounter = 0;
  private lengthTickModulo = 16384;

  // Our wave forms, picked based on duty cycle
  private samples = [
    [1, -1, -1, -1, -1, -1, -1, -1], // 12.5%
    [1, 1, -1, -1, -1, -1, -1, -1], // 25%
    [1, 1, 1, 1, -1, -1, -1, -1], // 50%
    [1, 1, 1, 1, 1, 1, -1, -1], // 75%
  ];
  // Number between 0 and 3
  private dutyCycle = 0;
  private samplePointer = 0;

  // value between 0 and 15
  private initialVolume = 0;
  private envelopeDirection: EnvelopeDirection = "INCREASE";
  // clocked at 64hz, that's every 65536 ticks
  // 0 = disabled
  private envelopeSweepPace = 1; // that's not the frequency sweep
  private envelopeTickCounter = 0;
  private envelopeTickModulo = 65536;

  // frequency sweep
  private sweepPace = 1; // this is essentially the sweep modulo
  private sweepPaceCounter = 0;
  private sweepDirection: SweepDirection = "UP";
  private sweepIndividualStep = 0;

  // sweep ticked every 126hz, that's every 32768 ticks
  private sweepTickCounter = 0;
  private sweepTickModulo = 32768;

  // Channel 1 and 2 are almost equivalent but channel 1 supports a sweep
  // which we'll just disable in channel 1;
  constructor(private enableSweep: boolean) {}

  // Called 4194304 per second;
  tick() {
    // period divider up counter clocked at 1048576, every 4 dots
    this.periodTickCounter = (this.periodTickCounter + 1) % this.periodClockTickModulo;
    if (this.periodTickCounter === 0) {
      if (this.periodUpCounter > 0x7ff) {
        // reset to period
        this.periodUpCounter = this.period;
        this.samplePointer = (this.samplePointer + 1) % 8;
      } else {
        this.periodUpCounter++;
      }
    }

    // length
    if (this.lengthEnabled) {
      this.lengthTickCounter = (this.lengthTickCounter + 1) % this.lengthTickModulo;
      if (this.lengthTickCounter === 0) {
        if (this.initialLength >= 64) {
          // turn off channel
          this.channelEnabled = false;
          this.volume = 0;
        } else {
          this.initialLength++;
        }
      }
    }

    // envelope, adjustments every 65536 * envelope sweep pace ticks
    if (this.envelopeSweepPace != 0) {
      this.envelopeTickCounter = (this.envelopeTickCounter + 1) % (this.envelopeTickModulo * this.envelopeSweepPace);
      if (this.envelopeTickCounter === 0) {
        if (this.envelopeDirection === "DECREASE") {
          // make quieter
          if (this.volume > 0) {
            this.volume = this.volume - 1;
          }
        } else {
          // make louder
          if (this.volume < 15) {
            this.volume = this.volume + 1;
          }
        }
      }
    }

    if (this.enableSweep) {
      // Todo: theoretically we'll have to write the computed frequencies back into the registers.
      // sweep happening in multiples of 128hz ticks, based on sweep pace
      this.sweepTickCounter = (this.sweepTickCounter + 1) % this.sweepTickModulo;
      if (this.sweepTickCounter === 0) {
        if (this.sweepPace !== 0) {
          this.sweepPaceCounter = (this.sweepPaceCounter + 1) % this.sweepPace;
          if (this.sweepPaceCounter === 0) {
            if (this.sweepDirection === "UP") {
              this.period = this.period + this.period / Math.pow(2, this.sweepIndividualStep);
              if (this.period > 0x7ff) {
                this.channelEnabled = false;
                this.period = 0x7ff;
                this.sweepPace = 0;
              }
            } else {
              this.period = this.period - this.period / Math.pow(2, this.sweepIndividualStep);
              if (this.period < 0) {
                this.period = 0;
                this.channelEnabled = false;
                this.sweepPace = 0;
              }
            }
          }
        }
      }
    }
  }

  trigger(sweepOptions?: SweepOptions) {
    this.samplePointer = 0;
    this.periodTickCounter = 0;
    this.sweepTickCounter = 0;
    this.sweepPaceCounter = 0;
    this.lengthTickCounter = 0;
    this.channelEnabled = true;
    this.volume = this.initialVolume;

    if (sweepOptions) {
      // sweep only read on trigger
      this.sweepPace = sweepOptions.sweepPace;
      this.sweepDirection = sweepOptions.sweepDirection;
      this.sweepIndividualStep = sweepOptions.sweepIndividualStep;
    }
  }

  setLengthEnabled(enabled: boolean) {
    this.lengthEnabled = enabled;
  }

  setInitialLength(value: number) {
    this.initialLength = value;
  }

  setPeriod(value: number) {
    if (value < 0x7ff) {
      this.period = value;
    } else {
      this.channelEnabled = false;
    }
  }

  getPeriod(): number {
    return this.period;
  }

  setEnvelopeInitialVolume(value: number) {
    this.initialVolume = value;
  }

  setEnvelopeDirection(value: EnvelopeDirection) {
    this.envelopeDirection = value;
  }

  setEnvelopeSweepPace(value: number) {
    this.envelopeSweepPace = value;
  }

  setDutyCycle(value: number) {
    this.dutyCycle = value;
  }

  getSample(): number {
    if (this.channelEnabled) {
      return this.samples[this.dutyCycle][this.samplePointer] * (this.volume / 15);
    } else {
      return 0;
    }
  }

  turnOff() {
    this.channelEnabled = false;
  }
}
