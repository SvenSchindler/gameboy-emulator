export class Channel3SampleGenerator {
  private channelEnabled = true;

  // Value between 0 and 1
  private volume = 1;

  // 4 bit sample per byte
  private samples: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  private actualSamples: number[] = [];
  private samplePointer = 0;

  // Turns of channel once it hits 64
  private lengthEnabled = false;
  private initialLength = 0;

  // This can be written at any time
  private period = 0;
  private periodUpCounter = 0;

  // period divider up counter clocked at 2097152, every 2 dots
  private periodTickCounter = 0;
  private periodClockTickModulo = 2;

  // length timer increased at 256hz, that's every 16384 ticks
  private lengthTickCounter = 0;
  private lengthTickModulo = 16384;

  // Channel 1 and 2 are almost equivalent but channel 1 supports a sweep
  // which we'll just disable in channel 1;
  constructor() {}

  // Called 4194304 per second;
  tick() {
    // period divider up counter clocked at 2097152, every 2 dots
    this.periodTickCounter = (this.periodTickCounter + 1) % this.periodClockTickModulo;
    if (this.periodTickCounter === 0) {
      if (this.periodUpCounter > 0x7ff) {
        // reset to period
        this.periodUpCounter = this.period;
        this.samplePointer = (this.samplePointer + 1) % 32;
      } else {
        this.periodUpCounter++;
      }
    }

    // length
    if (this.lengthEnabled) {
      this.lengthTickCounter = (this.lengthTickCounter + 1) % this.lengthTickModulo;
      if (this.lengthTickCounter === 0) {
        if (this.initialLength >= 256) {
          // turn off channel
          this.channelEnabled = false;
        } else {
          this.initialLength++;
        }
      }
    }
  }

  trigger() {
    this.samplePointer = 1;
    this.periodTickCounter = 0;
    this.lengthTickCounter = 0;
    this.actualSamples = this.samples;
    this.channelEnabled = true;
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

  setVolume(volume: number) {
    this.volume = volume;
  }

  setSamples(samples: number[]) {
    this.samples = samples;
  }

  enable() {
    this.channelEnabled = true;
  }

  disable() {
    this.channelEnabled = false;
  }

  getSample(): number {
    if (this.channelEnabled) {
      const nibble = this.samplePointer % 2 === 0 ? "HIGH" : "LOW";
      let sample = 0;
      if (nibble === "HIGH") {
        sample = (this.actualSamples[Math.round(this.samplePointer / 2)] >> 4) & 0xf;
      } else {
        sample = this.actualSamples[Math.round(this.samplePointer / 2)] & 0xf;
      }
      return ((sample / 15) * 2 - 1) * this.volume; // move it so that it's between -1 and 1
    } else {
      return 0;
    }
  }
}
