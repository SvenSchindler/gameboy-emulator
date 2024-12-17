import { toHexString } from "./utils";

export interface APU {
  // FF26 / NR52 - audio channels on off control
  writeAudioMasterControl: (value: number) => void;
  readAudioMasterControl: () => number;

  // FF25 / NR51 - audio channel panning
  writeAudioChannelPanning: (value: number) => void;
  readAudioChannelPanning: () => number;

  // FF24 / NR50 - audio channel panning
  writeMasterVolume: (value: number) => void;
  readMasterVolume: () => number;

  // FF10 - NR 10 Channel 1 Sweep
  writeChannel1Sweep: (value: number) => void;
  readChannel1Sweep: () => number;

  // FF11 - NR 11 Channel 1 length timer and duty cycle
  writeChannel1LengthAndDuty: (value: number) => void;
  readChannel1Duty: () => number; // length is write only

  // FF12 - NR12 channel 1 volume and envelope
  writeChannel1VolumeAndEnvelope: (value: number) => void;
  readChannel1VolumeAndEnvelope: () => number;

  // FF13 - NR13 channel 1 period low write only
  writeChannel1PeriodLow: (value: number) => void;

  // FF14 - NR14 channel 1 period high & control
  writeChannel1PeriodHighAndControl: (value: number) => void;
  readChannel1LengthEnable: () => number;

  // FF16 - NR21 Channel 2 length timer and duty cycle
  writeChannel2LengthAndDuty: (value: number) => void;
  readChannel2Duty: () => number; // length is write only

  // FF17 - NR22 channel 2 volume and envelope
  writeChannel2VolumeAndEnvelope: (value: number) => void;
  readChannel2VolumeAndEnvelope: () => number;

  // FF18 - NR23 channel 2 period low write only
  writeChannel2PeriodLow: (value: number) => void;

  // FF19 - NR24 channel 2 period high & control
  writeChannel2PeriodHighAndControl: (value: number) => void;
  readChannel2LengthEnable: () => number;

  // FF1A - NR 30 DAC on/off
  writeChannel3DACOnOff: (value: number) => void;
  readChannel3DACOnOff: () => number;
  // FF1B - NR 31 length timer / write only
  writeChannel3LengthTimer: (value: number) => void;
  // FF1C - NR 32 output level
  writeChannel3OutputLevel: (value: number) => void;
  readChannel3OutputLevel: () => number;
  // FF1D - NR 33 channel 3 period low
  writeChannel3PeriodLow: (value: number) => void;
  // FF1E - NR34 channel 3 period high and control
  writeChannel3PeriodHighAndControl: (value: number) => void;
  readChannel3Control: () => number;
  // FF30-FF3F 16 bytes wave pattern
  writeChannel3WavePattern: (address: number, value: number) => void;
  readChannel3WavePattern: (address: number) => number;

  // FF20 - NR41
  writeChannel4Length: (value: number) => void;
  // FF21 - NR42
  writeChannel4VolumeAndEnvelope: (value: number) => void;
  readChannel4VolumeAndEnvelope: () => number;
  // FF22 - NR43
  writeChannel4FrequencyAndRandomness: (value: number) => void;
  readChannel4FrequencyAndRandomness: () => number;
  // FF23 - NR44
  writeChannel4Control: (value: number) => void;
  readChannel4LengthEnable: () => number;

  tick: () => void;
  channel3Tick: () => void;

  mute: () => void;
  unmute: () => void;
}

type SweepDirection = "UP" | "DOWN";
type EnvelopeDirection = "INCREASE" | "DECREASE";

/**
 * Quick and hacky APU implementation, lacks a bunch of features:
 * -> phasing not implemented
 * -> no support for proper PCM sampling (would require major refactor)
 * -> frequency change without trigger not implemented
 * -> stereo support not implemented (left/right volumes)
 * */

export class APUImpl implements APU {
  private audioContext = new AudioContext();

  // This is our own addition to control master volume
  private readonly deafultVolume = 0.2;
  private volume = this.deafultVolume;

  // FF26 - NR52 - master audio control
  private NR52 = 0x00;

  // FF25 - NR51 - panning
  private NR51 = 0x00;

  // FF24 - NR50 - master volume (and vin panning which we ignore)
  private NR50 = 0x00;

  // FF10 - NR10 Channel 1 Sweep
  private NR10 = 0x00;

  // FF11 - NR11 Channel 1 length timer and duty cycle
  private NR11 = 0x00;

  // FF12 - NR12 channel 1 volume and envelope
  private NR12 = 0x00;

  // FF13 - NR13 channel 1 period low write only
  private NR13 = 0x00;

  // FF14 - NR14 channel 1 period high & control
  private NR14 = 0x00;

  // FF16 - NR 21 (equivalent to NR11)
  private NR21 = 0x00;
  // FF17 - NR 22 (equivalent to NR12)
  private NR22 = 0x00;
  // FF18 - NR 23 (equivalent to NR13)
  private NR23 = 0x00;
  // FF19 - NR 24 (equivalent to NR14)
  private NR24 = 0x00;

  // FF1A - NR 30 DAC on/off
  private NR30 = 0x00;
  // FF1B - NR 31 length timer / write only
  private NR31 = 0x00;
  // FF1C - NR 32 output level
  private NR32 = 0x00;
  // FF1D - NR 33 channel 3 period low
  private NR33 = 0x00;
  // FF1E - NR34 channel 3 period high and control
  private NR34 = 0x00;
  // FF30-FF3F 16 bytes wave pattern
  private FE30toFE3F = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Noise channel
  // FF20 - NR 41, channel 4 length, write only
  private NR41 = 0x00;
  // FF21 - NR 42 channel 4 volume and envelope
  private NR42 = 0x00;
  // FF22 - NR 43, frequency + randomness
  private NR43 = 0x00;
  // FF23 - NR 44
  private NR44 = 0x00;

  private channel4ClockShift = 0;
  private channel4LfsrWidth = 15;
  private channel4ClockDivider = 0.5;

  envelopeTickCounter = 0;
  soundLengthTickCounter = 0;
  channel1SweepTickCounter = 0;

  noiseChannelClockIncreaseCounter = 0;

  audioStartTime = 0;
  totalNumberOfSamplesSubmitted = 0;

  mainOutSampleIndex = 0;
  mainOutSamples: number[] = [];

  channel1Samples: number[] = [];
  channel1SampleIndex = 0;
  channel1Volume = 0;

  channel2Samples: number[] = [];
  channel2SampleIndex = 0;
  channel2Volume = 0;

  private channel3Samples: number[] = [0];
  private channel3SampleIndex = 0;
  private channel3Volume = 0;
  private channel3IsOn = false;
  private channel3WaveSampleIndex = 0;

  private readonly bufferAhead = 0.05;

  channel4Volume = 0;
  channel4IsOn = false;

  // we'll apply a mini envolope to each newly triggered sound
  // these will be reset by a trigger
  private envelopes = [0, 0, 0, 0];

  constructor() {
    // fill our round robin audio buffers up with 0
    for (let i = 0; i < 3 * this.audioContext.sampleRate; i++) {
      this.mainOutSamples[i] = 0;
    }
  }

  mute() {
    this.volume = 0;
  }

  unmute() {
    this.volume = this.deafultVolume;
  }

  // This is being called 1048576 times per second
  tick() {
    // Envelopes are ticked at 64hz, that's every 16384 cycles
    this.envelopeTickCounter = (this.envelopeTickCounter + 1) % 16384;
    if (this.envelopeTickCounter === 0) {
      this.handleChannel1Envelope();
      this.handleChannel2Envelope();
      this.handleChannel4Envelope();

      // Mix streams together and play audio
      if (this.audioStartTime === 0) {
        this.audioStartTime = this.audioContext.currentTime;
      }
      const time = this.audioContext.currentTime;
      const totalTimePassed = time - this.audioStartTime;
      const samplesToSubmit =
        (totalTimePassed + this.bufferAhead) * this.audioContext.sampleRate - this.totalNumberOfSamplesSubmitted;

      if (samplesToSubmit > 0) {
        const buffer = this.audioContext.createBuffer(
          1,
          samplesToSubmit, // check this math, seems to be way off
          this.audioContext.sampleRate,
        );
        const nowBuffering = buffer.getChannelData(0);

        // clock the noise channel based on the buffer length
        const lfsrClockFrequencey = 262144 / (this.channel4ClockDivider * (1 << this.channel4ClockShift)); // 1048576 / 4 = 262144
        const samplesAfterWeNeedToClock = Math.round(this.audioContext.sampleRate / lfsrClockFrequencey); // Todo: for very fast lfsr clocks we need to sample multiple times per sample
        let numberOfClocksPerSample = 1;
        if (samplesAfterWeNeedToClock === 0) {
          numberOfClocksPerSample = Math.round(lfsrClockFrequencey / this.audioContext.sampleRate);
        }

        for (let i = 0; i < buffer.length; i++) {
          // combine audio channels into main channel
          this.mainOutSamples[this.mainOutSampleIndex] = 0;
          // channel 1
          if (this.channel1Samples[this.channel1SampleIndex]) {
            this.mainOutSamples[this.mainOutSampleIndex] =
              this.mainOutSamples[this.mainOutSampleIndex] +
              this.channel1Samples[this.channel1SampleIndex] * (this.channel1Volume / 15 / 4) * this.envelopes[0];
          }
          this.channel1SampleIndex = (this.channel1SampleIndex + 1) % this.channel1Samples.length;
          // channel 2
          if (this.channel2Samples[this.channel2SampleIndex]) {
            this.mainOutSamples[this.mainOutSampleIndex] =
              this.mainOutSamples[this.mainOutSampleIndex] +
              this.channel2Samples[this.channel2SampleIndex] * (this.channel2Volume / 15 / 4) * this.envelopes[1];
          }
          this.channel2SampleIndex = (this.channel2SampleIndex + 1) % this.channel2Samples.length;
          // channel 3
          if (this.channel3IsOn) {
            let nextSample = this.channel3Samples[this.channel3SampleIndex];
            this.mainOutSamples[this.mainOutSampleIndex] =
              this.mainOutSamples[this.mainOutSampleIndex] +
              nextSample * (this.channel3Volume / 4) * 0.6 * this.envelopes[2];
          }
          this.channel3SampleIndex = (this.channel3SampleIndex + 1) % this.channel3Samples.length;
          // channel 4
          if (this.channel4IsOn) {
            // one lfsr clock spans multiple samples
            if (samplesAfterWeNeedToClock > 0) {
              this.noiseChannelClockIncreaseCounter =
                (this.noiseChannelClockIncreaseCounter + 1) % samplesAfterWeNeedToClock;
              if (this.noiseChannelClockIncreaseCounter === 0) {
                this.getNextLFSRSample(); // this will clock it.
              }
            } else {
              // one sample clocks the lfsr multiple times
              for (let i = 0; i < numberOfClocksPerSample; i++) {
                this.getNextLFSRSample();
              }
            }

            const noiseOuput = this.channel4LfsrState & 1;
            this.mainOutSamples[this.mainOutSampleIndex] =
              this.mainOutSamples[this.mainOutSampleIndex] +
              noiseOuput * (this.channel4Volume / 15 / 4) * this.envelopes[3];
          }

          // copy main samples into buffer
          nowBuffering[i] = this.mainOutSamples[this.mainOutSampleIndex] * this.volume;
          this.mainOutSampleIndex = (this.mainOutSampleIndex + 1) % this.mainOutSamples.length;

          // not really needed
          for (let i = 0; i < this.envelopes.length; i++) {
            if (this.envelopes[i] < 1) {
              this.envelopes[i] = this.envelopes[i] + 1;
            }
          }
        }
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);

        // one blob should be played for 1/64 of a second
        const nextTime = this.audioStartTime + this.totalNumberOfSamplesSubmitted / this.audioContext.sampleRate;
        source.start(nextTime);
        this.totalNumberOfSamplesSubmitted += samplesToSubmit;
      }
    }

    // Sound length ticks at 256 hz which means every 4096 ticks
    this.soundLengthTickCounter = (this.soundLengthTickCounter + 1) % 4096;
    if (this.soundLengthTickCounter === 0) {
      this.handleChannel1Length();
      this.handleChannel2Length();
      this.handleChannel3Length();
      this.handleChannel4Length();
    }

    // Channel 1 sweep ticks at 128 hz, so every 8192 ticks
    this.channel1SweepTickCounter = (this.channel1SweepTickCounter + 1) % 8192;
    if (this.channel1SweepTickCounter === 0) {
      this.hanldeChannel1Sweep();
      this.deleteMe();
    }
  }

  channel1EnvelopModulo = 0;

  handleChannel1Envelope() {
    const sweepPace = this.NR12 & 0b111;
    if (sweepPace === 0) {
      return;
    }
    if (this.channel1EnvelopModulo === 0) {
      const envelopeDirection: EnvelopeDirection = ((this.NR12 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
      if (envelopeDirection === "INCREASE" && this.channel1Volume < 15) {
        this.channel1Volume++;
      } else if (envelopeDirection === "DECREASE" && this.channel1Volume > 0) {
        this.channel1Volume--;
      }
    }
    this.channel1EnvelopModulo = (this.channel1EnvelopModulo + 1) % sweepPace;
  }

  channel2EnvelopModulo = 0;

  handleChannel2Envelope() {
    const sweepPace = this.NR22 & 0b111;
    if (sweepPace === 0) {
      return;
    }
    if (this.channel2EnvelopModulo === 0) {
      const envelopeDirection: EnvelopeDirection = ((this.NR22 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
      if (envelopeDirection === "INCREASE" && this.channel2Volume < 15) {
        this.channel2Volume++;
      } else if (envelopeDirection === "DECREASE" && this.channel2Volume > 0) {
        this.channel2Volume--;
      }
    }
    this.channel2EnvelopModulo = (this.channel2EnvelopModulo + 1) % sweepPace;
  }

  channel4EnvelopModulo = 0;

  handleChannel4Envelope() {
    const sweepPace = this.NR42 & 0b111;
    if (sweepPace === 0) {
      return;
    }
    if (this.channel4EnvelopModulo === 0) {
      const envelopeDirection: EnvelopeDirection = ((this.NR42 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
      if (envelopeDirection === "INCREASE" && this.channel4Volume < 15) {
        this.channel4Volume++;
      } else if (envelopeDirection === "DECREASE" && this.channel4Volume > 0) {
        this.channel4Volume--;
      }
    }
    this.channel4EnvelopModulo = (this.channel4EnvelopModulo + 1) % sweepPace;
  }

  handleChannel1Length() {
    const lengthEnable = (this.NR14 >> 6) & 0x1;
    if (!lengthEnable) {
      return;
    }
    let channel1Length = this.NR11 & 0b111111;
    channel1Length++;
    if (channel1Length >= 64) {
      // cut off channel
      this.channel1Samples = [0];
      this.channel1SampleIndex = 0;
    }
    this.NR11 = (this.NR11 & 0b000000) | (channel1Length & 0b111111);
  }

  handleChannel2Length() {
    const lengthEnable = (this.NR24 >> 6) & 0x1;
    if (!lengthEnable) {
      return;
    }
    let channel2Length = this.NR21 & 0b111111;
    channel2Length++;
    if (channel2Length >= 64) {
      // cut off channel
      this.channel2Samples = [0];
      this.channel2SampleIndex = 0;
    }
    this.NR21 = (this.NR21 & 0b000000) | (channel2Length & 0b111111);
  }

  // 8 bit length for channel 3 in contrast to the others
  handleChannel3Length() {
    const lengthEnable = (this.NR34 >> 6) & 0x1;
    if (!lengthEnable) {
      return;
    }
    let channel3Length = this.NR31;
    channel3Length++;
    if (channel3Length >= 64) {
      // cut off channel
      this.channel3IsOn = false;
    }
    this.NR31 = channel3Length & 0xff;
  }

  handleChannel4Length() {
    const lengthEnable = (this.NR44 >> 6) & 0x1;
    if (!lengthEnable) {
      return;
    }
    let channel4Length = this.NR41 & 0b111111;
    channel4Length++;
    if (channel4Length >= 64) {
      // cut off channel
      this.channel4IsOn = false;
    }
    this.NR41 = (this.NR41 & 0b000000) | (channel4Length & 0b111111);
  }

  sweepModulo = 0;

  hanldeChannel1Sweep() {
    // Number of iterations in 128 hz ticks (7.8 ms), field not re-read until finished!
    // 0 written to 0, sweep instantly stops

    if (this.sweepPace === 0) {
      return;
    }

    if (this.sweepModulo === 0) {
      const step = this.NR10 & 0b111;
      const direction: SweepDirection = ((this.NR10 >> 3) & 0x1) === 0x0 ? "UP" : "DOWN";

      let period = ((this.NR14 & 0b111) << 8) | (this.NR13 & 0xff);
      if (direction === "UP") {
        console.log("up");
        period = period + period / (1 << step);
      } else {
        period = period - period / (1 << step);
      }

      if (period > 0x7ff || period <= 0) {
        // switch off channel
        this.channel1Samples = [0];
        this.channel1SampleIndex = 0;
        return;
      }

      // write back period
      this.NR13 = period & 0xff;
      this.NR14 = (this.NR14 & 0b1111_1000) | (period >> 8);

      this.updateChannel1Samples(period);
    }

    this.sweepModulo = (this.sweepModulo + 1) % this.sweepPace;
  }

  private updateChannel1Samples(period: number) {
    const pediodLength = 2048 - period;
    // 1048576 / 8 because 8 samples per wave form
    const frequency = 1048576 / 8 / pediodLength;
    const sampleRate = this.audioContext.sampleRate;
    const samplesPerWave = sampleRate / frequency;
    this.channel1Samples = [];
    this.channel1SampleIndex = 0;
    // we could also implement a ring buffer here
    for (let i = 0; i < samplesPerWave; i++) {
      // audio needs to be in [-1.0; 1.0]
      // Todo: for now we're just using a perfect square wave to keeps things simple,
      // in reality, these could have different phases, based on 0xFF11.
      this.channel1Samples[i] = Math.round(i / samplesPerWave) * 2 - 1;
    }
  }

  private updateChannel2Samples(period: number) {
    const pediodLength = 2048 - period;
    // 1048576 / 8 because 8 samples per wave form
    const frequency = 1048576 / 8 / pediodLength;
    const sampleRate = this.audioContext.sampleRate;
    const samplesPerWave = sampleRate / frequency;
    this.channel2Samples = [];
    this.channel2SampleIndex = 0;
    // we could also implement a ring buffer here
    for (let i = 0; i < samplesPerWave; i++) {
      // audio needs to be in [-1.0; 1.0]
      // Todo: for now we're just using a perfect square wave,
      // same as for channel 1
      this.channel2Samples[i] = Math.round(i / samplesPerWave) * 2 - 1;
    }
  }

  // We're not fully supporting PCM here since that would require a
  // major refactoring of the entire audio playback to keep all
  // channels in sync.
  private updateChannel3Samples(period: number) {
    this.channel3Samples = [0, 0];
    this.channel3SampleIndex = 1; // wave usually starts at 1
    const frequency = 65536 / (2048 - period);
    const samplesRequired = this.audioContext.sampleRate / frequency;
    for (let i = 0; i < samplesRequired; i++) {
      // 32 samples
      const sampleIndex = (31 / samplesRequired) * i;
      const sample = this.getChannel3WaveSampleAtIndex(i);
      this.channel3Samples[i] = sample;
    }
  }

  channel3SampleChanged = false;
  private deleteMe() {
    if (!this.channel3SampleChanged) {
      return;
    }

    const outputLevel = (this.NR32 >> 5) & 0b11;
    this.channel3Volume = this.channel3Volumes[outputLevel];

    const period = ((this.NR34 & 0b111) << 8) | (this.NR33 & 0xff);
    this.channel3Samples = [0, 0];
    const frequency = 65536 / (2048 - period);
    const samplesRequired = this.audioContext.sampleRate / frequency;
    for (let i = 0; i < samplesRequired; i++) {
      // 32 samples
      const sampleIndex = (31 / samplesRequired) * i;
      const sample = this.getChannel3WaveSampleAtIndex(i);
      this.channel3Samples[i] = sample;
    }

    if (this.channel3SampleIndex >= samplesRequired) {
      this.channel3SampleIndex = 1;
    }
  }

  private getChannel3WaveSampleAtIndex(index: number) {
    const channel3WavePattern = this.FE30toFE3F;
    const nibble = index % 2 === 0 ? "HIGH" : "LOW";
    let sample = 0;
    if (nibble === "HIGH") {
      sample = channel3WavePattern[Math.round(index / 2)] >> 4;
    } else {
      sample = channel3WavePattern[Math.round(index / 2)] & 0xf;
    }
    return (sample / 15) * 2 - 1; // move it so that it's between -1 and 1
  }

  writeAudioMasterControl(value: number) {
    // only the global on off bit is writeable, the rest is read only
    this.NR52 = this.NR52 | (value & 0b1000_000);
    if (((value >> 7) & 0x1) === 0x1) {
      console.log("master audio switched on");
    } else {
      console.log("master audio switched off");
    }
  }

  readAudioMasterControl() {
    return this.NR52;
  }

  writeAudioChannelPanning(value: number) {
    this.NR51 = value & 0xff;

    // mute channels if panning is off on both sides

    // channel 1
    // right && left
    if (!(this.NR51 & 0b0000_0001) && !(this.NR51 & 0b0001_0000)) {
      this.channel1Volume = 0;
    }

    // channel 2
    // right && left
    if (!(this.NR51 & 0b0000_0010) && !(this.NR51 & 0b0010_0000)) {
      this.channel2Volume = 0;
    }

    // channel 3
    // right && left
    if (!(this.NR51 & 0b0000_0100) && !(this.NR51 & 0b0100_0000)) {
      this.channel3Volume = 0;
    }

    // channel 4
    // right && left
    if (!(this.NR51 & 0b0000_1000) && !(this.NR51 & 0b1000_0000)) {
      this.channel4Volume = 0;
    }
  }

  readAudioChannelPanning() {
    return this.NR51;
  }

  writeMasterVolume(value: number) {
    this.NR50 = value & 0xff;
  }

  readMasterVolume() {
    return this.NR50;
  }

  getVolumeRight() {
    return this.NR50 & 0b111;
  }

  getVolumeLeft() {
    return (this.NR50 >> 4) & 0b111;
  }

  sweepPace = 0;
  writeChannel1Sweep(value: number) {
    this.NR10 = value & 0xff;

    // const step = this.NR10 & 0b111;
    // const direction: SweepDirection = this.NR10 >> 3 === 0x0 ? "UP" : "DOWN";
    // Number of iterations in 128 hz ticks (7.8 ms), field not re-read until finished!
    // 0 written to 0, sweep instantly stops
    const pace = (this.NR10 >> 4) & 0b111;
    this.sweepPace = pace;
  }

  readChannel1Sweep() {
    return this.NR10;
  }

  writeChannel1LengthAndDuty(value: number) {
    this.NR11 = value & 0xff;
    // the higher the value the shorter before the signal is cut
    // write only

    // Other fields (not used in this function):
    // const initialLength = this.NR11 & 0b111111;
    // const waveDuty = (this.NR11 >> 6) & 0b11;
  }

  readChannel1Duty() {
    // the initial length timer is write only
    return this.NR11 & 0b11000000;
  }

  writeChannel1VolumeAndEnvelope(value: number) {
    this.NR12 = value & 0xff;
    // Other fields (not used in this function):
    // const sweepPace = this.NR12 & 0b111;
    // const envelopeDirection: EnvelopeDirection =
    //   ((this.NR12 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
    // // not updated by envelope
    // const initialVolume = (this.NR12 >> 4) & 0b1111;
  }

  readChannel1VolumeAndEnvelope() {
    return this.NR12;
  }

  writeChannel1PeriodLow(value: number) {
    this.NR13 = value & 0xff;
    // Todo: normally we should update the period here too
  }

  writeChannel1PeriodHighAndControl(value: number) {
    this.NR14 = value & 0xff;
    const trigger = (this.NR14 >> 7) & 0x1;

    if (trigger) {
      this.envelopes[0] = 0;
      const initialVolume = (this.NR12 >> 4) & 0b1111;
      this.channel1Volume = initialVolume;
      const period = ((this.NR14 & 0b111) << 8) | (this.NR13 & 0xff);
      this.updateChannel1Samples(period);
    }
    // Todo: we should always update the period here but that would require
    // a different buffer handling approach.
  }

  readChannel1LengthEnable() {
    // trigger and period are write only values
    return this.NR14 & 0b01000000;
  }

  writeChannel2LengthAndDuty(value: number) {
    this.NR21 = value & 0xff;
    // the higher the value the shorter before the signal is cut
    // write only
    // Other fields (not used in this function):
    // const initialLength = this.NR21 & 0b111111;
    // const waveDuty = (this.NR21 >> 6) & 0b11;
    // console.log(`Channel one length ${initialLength}, wave duty: ${waveDuty}`);
  }

  readChannel2Duty() {
    // the initial length timer is write only
    return this.NR21 & 0b11000000;
  }

  writeChannel2VolumeAndEnvelope(value: number) {
    this.NR22 = value & 0xff;
    const sweepPace = this.NR22 & 0b111;
    const envelopeDirection: EnvelopeDirection = ((this.NR22 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
    // Other fields (not used in this function):
    // not updated by envelope
    // const initialVolume = (this.NR22 >> 4) & 0b1111;
  }

  readChannel2VolumeAndEnvelope() {
    return this.NR22;
  }

  writeChannel2PeriodLow(value: number) {
    this.NR23 = value & 0xff;
    // Other fields (not used in this function):
    // const periodBitsLow = this.NR23;
  }

  writeChannel2PeriodHighAndControl(value: number) {
    this.NR24 = value & 0xff;
    const trigger = (this.NR24 >> 7) & 0x1;

    // any value triggers this channel
    if (trigger) {
      // console.log('channel 2 triggred');
      this.envelopes[1] = 0;
      const period = ((this.NR24 & 0b111) << 8) | (this.NR23 & 0xff);
      const initialVolume = (this.NR22 >> 4) & 0b1111;
      this.channel2Volume = initialVolume;
      // Todo: this should just be the same as 2048 - period value
      // const periodLenghtInTicks = signedFrom11Bits(period);
      this.updateChannel2Samples(period);
    }
  }

  readChannel2LengthEnable() {
    // trigger and period are write only values
    return this.NR24 & 0b01000000;
  }

  // Channel 3, custom wave
  // FF1A - NR 30 DAC on/off
  writeChannel3DACOnOff(value: number) {
    this.NR30 = value & 0x8;
    if ((this.NR30 >> 7 && 1) === 1) {
      this.channel3IsOn = true;
    } else {
      this.channel3IsOn = false;
      this.channel3Volume = 0;
    }
  }

  readChannel3DACOnOff() {
    return this.NR30 & 0x8;
  }

  // FF1B - NR 31 length timer / write only
  writeChannel3LengthTimer(value: number) {
    this.NR31 = value & 0xff;
  }

  // FF1C - NR 32 output level
  writeChannel3OutputLevel(value: number) {
    this.NR32 = value & 0xff;
    const outputLevel = (this.NR32 >> 5) & 0b11;
    this.channel3Volume = this.channel3Volumes[outputLevel];
  }
  channel3Volumes = [0, 1, 0.5, 0.25];

  readChannel3OutputLevel() {
    return this.NR32;
  }

  // FF1D - NR 33 channel 3 period low
  writeChannel3PeriodLow(value: number) {
    this.NR33 = value & 0xff;
  }

  // FF1E - NR34 channel 3 period high and control
  writeChannel3PeriodHighAndControl(value: number) {
    this.NR34 = value & 0xff;
    const trigger = (this.NR34 >> 7) & 0x1;

    // any value triggers this channel
    if (trigger) {
      // console.log('channel 3 triggred');
      this.envelopes[2] = 0;
      const period = ((this.NR34 & 0b111) << 8) | (this.NR33 & 0xff);
      const outputLevel = (this.NR32 >> 5) & 0b11;
      this.channel3Volume = this.channel3Volumes[outputLevel];
      this.channel3IsOn = true;
      this.channel3WaveSampleIndex = 1;
      this.updateChannel3Samples(period);
    }
  }
  readChannel3Control() {
    return this.NR34 & 0b0100_0000;
  }

  // FF30-FF3F 16 bytes wave pattern
  writeChannel3WavePattern(address: number, value: number) {
    this.channel3SampleChanged = true;
    // todo: put this back in
    this.FE30toFE3F[address] = value & 0xff;
  }

  readChannel3WavePattern(address: number) {
    return this.FE30toFE3F[address];
  }

  getNextChannel3WaveSample(): number {
    const channel3WavePattern = this.FE30toFE3F;
    const nibble = this.channel3WaveSampleIndex % 2 === 0 ? "HIGH" : "LOW";
    let sample = 0;
    if (nibble === "HIGH") {
      sample = channel3WavePattern[Math.round(this.channel3WaveSampleIndex / 2)] >> 4;
    } else {
      sample = channel3WavePattern[Math.round(this.channel3WaveSampleIndex / 2)] & 0xf;
    }
    sample = (sample / 15) * 2 - 1; // move it so that it's between -1 and 1
    this.channel3WaveSampleIndex = (this.channel3WaveSampleIndex + 1) % 32; // 32 samples in the buffer
    return sample;
  }

  // Channel 4, noise channel
  writeChannel4Length(value: number): void {
    this.NR41 = value & 0b11_1111;
  }

  writeChannel4VolumeAndEnvelope(value: number) {
    this.NR42 = value & 0xff;
    const sweepPace = this.NR42 & 0b111;
    const envelopeDirection: EnvelopeDirection = ((this.NR42 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
    // not updated by envelope
    const initialVolume = (this.NR42 >> 4) & 0b1111;
  }

  readChannel4VolumeAndEnvelope() {
    return this.NR42;
  }

  writeChannel4FrequencyAndRandomness(value: number) {
    this.NR43 = value & 0xff;
    this.channel4ClockShift = (value >> 4) & 0xf;
    this.channel4LfsrWidth = ((value >> 3) & 0x1) === 0x1 ? 7 : 15;
    this.channel4ClockDivider = (value & 0b111) === 0 ? 0.5 : value & 0b111;
  }

  readChannel4FrequencyAndRandomness() {
    return this.NR43;
  }

  // FF43 - NR44
  writeChannel4Control(value: number) {
    this.NR44 = value & 0xff;

    const trigger = (this.NR44 >> 7) & 0x1;

    // any value triggers this channel
    if (trigger) {
      this.envelopes[3] = 0;
      const initialVolume = (this.NR42 >> 4) & 0b1111;
      this.channel4Volume = initialVolume;
      this.channel4IsOn = true;
    }
  }
  readChannel4LengthEnable() {
    return this.NR44 & 0b01000000;
  }

  // We're pre-generating these
  private channel4LfsrState = Math.pow(2, this.channel4LfsrWidth) - 1;
  getNextLFSRSample(): number {
    let result = this.channel4LfsrState & 1;
    let oneBeforeLast = (this.channel4LfsrState >> 1) & 1;
    this.channel4LfsrState = (this.channel4LfsrState >> 1) | ((result ^ oneBeforeLast) << (this.channel4LfsrWidth - 1));
    return result;
  }

  // Supporting proper pcm based on channel 3 ticks would require some refactoring to the audio engine
  channel3Tick() {}
}
