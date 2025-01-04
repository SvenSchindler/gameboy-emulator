import { EnvelopeDirection } from "./apu-utils";

export class Channel4SampleGenerator {
  private channelEnabled = false;

  private channel4LfsrWidth = 15;

  private channel4LfsrState = Math.pow(2, this.channel4LfsrWidth) - 1;

  private lfsrClockDivider = 1;

  private currentSample = 0;

  private clockShift = 1;

  // length timer increased at 256hz, that's every 16384 ticks
  private lengthTickCounter = 0;
  private lengthTickModulo = 16384;

  // Value between 0 and 15
  private volume = 0;

  // Turns of channel once it hits 64
  private lengthEnabled = false;
  private initialLength = 0;

  // value between 0 and 15
  private initialVolume = 0;
  private envelopeDirection: EnvelopeDirection = "INCREASE";
  private nextEnvelopeDirection: EnvelopeDirection = "INCREASE"; // value read and copied to envelope direction on re-trigger
  // clocked at 64hz, that's every 65536 ticks
  // 0 = disabled
  private envelopeSweepPace = 1; // that's not the frequency sweep
  private nextEnvelopeSweepPace = 0; // read on re-trigger
  private envelopeTickCounter = 0;
  private envelopeTickModulo = 65536;

  private tickCounter = 0;
  private tickModulo = 1; // calculated later as part of lfsr frequency

  // Called 4194304 per second;
  tick() {
    // lfsr is clocked at 262144 / (divider * 2^shift)
    // this can be rewritten as 4194304 / (16 * divider * 2^shift)
    // a divider value of 0 get's mapped to 0.5
    this.tickCounter = (this.tickCounter + 1) % this.tickModulo;
    if (this.tickCounter === 0) {
      this.currentSample = this.getNextLFSRSample() * 2 - 1; // scale [0,1] to [-1,1]
    }

    // length
    if (this.lengthEnabled) {
      this.lengthTickCounter = (this.lengthTickCounter + 1) % this.lengthTickModulo;
      if (this.lengthTickCounter === 0) {
        if (this.initialLength >= 64) {
          // turn off channel
          this.volume = 0;
          this.channelEnabled = false;
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
  }

  trigger() {
    this.channelEnabled = true;
    this.lengthTickCounter = 0;
    this.channelEnabled = true;
    this.envelopeSweepPace = this.nextEnvelopeSweepPace;
    this.envelopeDirection = this.nextEnvelopeDirection;
    this.volume = this.initialVolume;
    this.envelopeTickCounter = 0;
    this.channel4LfsrState = Math.pow(2, this.channel4LfsrWidth) - 1;
    this.tickModulo = Math.floor(16 * this.lfsrClockDivider * Math.pow(2, this.clockShift));
  }

  getSample(): number {
    if (this.channelEnabled) {
      return this.currentSample * (this.volume / 15);
    } else {
      return 0;
    }
  }

  setInitialLengthTimer(value: number) {
    this.initialLength = value;
  }

  setEnvelopeInitialVolume(value: number) {
    this.initialVolume = value;
  }

  setEnvelopeDirection(value: EnvelopeDirection) {
    this.nextEnvelopeDirection = value;
  }

  setEnvelopeSweepPace(value: number) {
    this.nextEnvelopeSweepPace = value;
  }

  setClockShift(value: number) {
    this.clockShift = value;
  }

  setLfsrWidth(value: number) {
    this.channel4LfsrWidth = value;
  }

  setLsfrClockDivider(value: number) {
    if (value === 0) {
      this.lfsrClockDivider = 0.5;
    } else {
      this.lfsrClockDivider = value;
    }
  }

  setLengthEnabled(value: boolean) {
    this.lengthEnabled = value;
  }

  private getNextLFSRSample(): number {
    let result = this.channel4LfsrState & 1;
    let oneBeforeLast = (this.channel4LfsrState >> 1) & 1;
    this.channel4LfsrState = (this.channel4LfsrState >> 1) | ((result ^ oneBeforeLast) << (this.channel4LfsrWidth - 1));
    return result;
  }

  turnOff() {
    this.channelEnabled = false;
  }
}
