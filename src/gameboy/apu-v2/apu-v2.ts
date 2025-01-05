import { EnvelopeDirection } from "./apu-utils";
import { Channel1And2SampleGenerator } from "./channel-1-and-2-generator";
import { APU } from "../apu";
import { Channel3SampleGenerator } from "./channel-3-generator";
import { Channel4SampleGenerator } from "./channel-4-generator";

export class ApuV2Impl implements APU {
  private audioContext = new AudioContext();

  // This is our own addition to control master volume
  private readonly defaultVolume = 0.4;
  private volume = this.defaultVolume;

  // FF26 - NR52 - master audio control
  private NR52 = 0xff;

  // FF25 - NR51 - panning
  private NR51 = 0x00;

  // FF24 - NR50 - master volume (and vin panning which we ignore)
  private NR50 = 0xff;

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

  private channel4LfsrWidth = 15;

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

  channel3Volume = 0;
  channel3IsOn = false;

  channel4Volume = 0;
  channel4ClockShift = 0;
  channel4ClockDivider = 0;
  channel4IsOn = false;

  private channel1SampleGenerator: Channel1And2SampleGenerator;
  private channel2SampleGenerator: Channel1And2SampleGenerator;
  private channel3SampleGenerator: Channel3SampleGenerator;
  private channel4SampleGenerator: Channel4SampleGenerator;

  // we'll apply a mini envolope to each newly triggered sound
  // these will be reset by a trigger
  private envelopes = [0, 0, 0, 0];

  constructor() {
    this.channel1SampleGenerator = new Channel1And2SampleGenerator(true);
    this.channel2SampleGenerator = new Channel1And2SampleGenerator(false);
    this.channel3SampleGenerator = new Channel3SampleGenerator();
    this.channel4SampleGenerator = new Channel4SampleGenerator();
  }

  mute() {
    this.volume = 0;
  }

  unmute() {
    this.volume = this.defaultVolume;
  }

  globalBufferLeft: number[] = []; // max length 441
  globalBufferRight: number[] = []; // max length 441

  // This needs to be called 4194304 times per second
  private ticksPerSecond = 4194304;
  private globalTickCounter = 0;
  private firstBlockStartTime = 0;
  private samplesSubmitted = 0;
  private samplesGeneratedForSecond = 0;
  tick() {
    this.channel1SampleGenerator.tick();
    this.channel2SampleGenerator.tick();
    this.channel3SampleGenerator.tick();
    this.channel4SampleGenerator.tick();
    // sample rate 44100
    // by generating a sample every 95 ticks and dropping one every 82943 we're getting very close
    // to the sample rate
    // (4194304 / 95) - (4194304 / 82943)
    this.globalTickCounter = (this.globalTickCounter + 1) % this.ticksPerSecond;
    if (this.globalTickCounter === 0) {
      this.samplesGeneratedForSecond = 0;
    }

    // this creates exactly 44100 samples in 4194304 cycles
    if (Math.floor(this.globalTickCounter / (this.ticksPerSecond / 44100)) > this.samplesGeneratedForSecond - 1) {
      this.samplesGeneratedForSecond++;
      // Channel 1
      let channel1SampleLeft = 0;
      let channel1SampleRight = 0;

      if (((this.NR51 >> 4) & 0x1) === 0x1 && (this.NR51 & 0x1) === 0x0) {
        // ch1 left only
        channel1SampleLeft = this.channel1SampleGenerator.getSample();
      } else if (((this.NR51 >> 4) & 0x1) === 0x0 && (this.NR51 & 0x1) === 0x1) {
        // right only
        channel1SampleRight = this.channel1SampleGenerator.getSample();
      } else {
        // both
        channel1SampleLeft = this.channel1SampleGenerator.getSample();
        channel1SampleRight = this.channel1SampleGenerator.getSample();
      }

      // Channel 2
      let channel2SampleLeft = 0;
      let channel2SampleRight = 0;
      // left
      if (((this.NR51 >> 5) & 0x1) === 0x1 && ((this.NR51 >> 1) & 0x1) === 0x0) {
        // ch2 left only
        channel2SampleLeft = this.channel2SampleGenerator.getSample();
      } else if (((this.NR51 >> 5) & 0x1) === 0x0 && ((this.NR51 >> 1) & 0x1) === 0x1) {
        // ch2 right only
        channel2SampleRight = this.channel2SampleGenerator.getSample();
      } else {
        channel2SampleLeft = this.channel2SampleGenerator.getSample();
        channel2SampleRight = this.channel2SampleGenerator.getSample();
      }

      // Channel 3
      let channel3SampleLeft = 0;
      let channel3SampleRight = 0;
      // left
      if (((this.NR51 >> 6) & 0x1) === 0x1 && ((this.NR51 >> 2) & 0x1) === 0x0) {
        // ch3 left on?
        channel3SampleLeft = this.channel3SampleGenerator.getSample();
      } else if (((this.NR51 >> 6) & 0x1) === 0x0 && ((this.NR51 >> 2) & 0x1) === 0x1) {
        // ch3 right on?
        channel3SampleRight = this.channel3SampleGenerator.getSample();
      } else {
        channel3SampleLeft = this.channel3SampleGenerator.getSample();
        channel3SampleRight = this.channel3SampleGenerator.getSample();
      }
      // channel 3 is a bit quieter than the other ones on the real game boy
      const channel3VolumeFactor = 0.7;
      channel3SampleLeft = channel3SampleLeft * channel3VolumeFactor;
      channel3SampleRight = channel3SampleRight * channel3VolumeFactor;

      // Channel 4
      let channel4SampleLeft = 0;
      let channel4SampleRight = 0;
      // left
      if (((this.NR51 >> 6) & 0x1) === 0x1 && ((this.NR51 >> 2) & 0x1) === 0x0) {
        // ch3 left on?
        channel4SampleLeft = this.channel4SampleGenerator.getSample();
      } else if (((this.NR51 >> 6) & 0x1) === 0x0 && ((this.NR51 >> 2) & 0x1) === 0x1) {
        // ch3 right on?
        channel4SampleRight = this.channel4SampleGenerator.getSample();
      } else {
        channel4SampleLeft = this.channel4SampleGenerator.getSample();
        channel4SampleRight = this.channel4SampleGenerator.getSample();
      }

      // channel 4 can be a bit too sharp so we're just making it a bit quieter
      const channel4VolumeFactor = 0.6;
      channel4SampleLeft = channel4SampleLeft * channel4VolumeFactor;
      channel4SampleRight = channel4SampleRight * channel4VolumeFactor;

      this.globalBufferLeft.push(
        (channel1SampleLeft + channel2SampleLeft + channel3SampleLeft + channel4SampleLeft) / 4,
      );
      this.globalBufferRight.push(
        (channel1SampleRight + channel2SampleRight + channel3SampleRight + channel4SampleRight) / 4,
      );
    }

    // Copy audio to audio buffer
    const leftVolume = (((this.NR50 >> 4) & 0b111) / 7) * this.volume;
    const rightVolume = ((this.NR50 & 0b111) / 7) * this.volume;
    // This gets called exactly 100 times per second (we should do this based on tick count)
    if (this.globalBufferLeft.length === 441) {
      // submit samples
      const buffer = this.audioContext.createBuffer(
        2, // channel left + right
        this.globalBufferLeft.length,
        44100,
      );

      // we should probably directly copy into the buffer
      // Fill left buffer
      const bufferDataLeft = buffer.getChannelData(0);
      for (let i = 0; i < this.globalBufferLeft.length; i++) {
        bufferDataLeft[i] = this.globalBufferLeft[i] * leftVolume;
      }

      // Fill right buffer
      const bufferDataRight = buffer.getChannelData(1);
      for (let i = 0; i < this.globalBufferRight.length; i++) {
        bufferDataRight[i] = this.globalBufferRight[i] * rightVolume;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);

      // First block
      if (
        this.samplesSubmitted === 0 ||
        this.firstBlockStartTime + this.samplesSubmitted / 44100 < this.audioContext.currentTime
      ) {
        this.samplesSubmitted = 0;
        this.firstBlockStartTime = this.audioContext.currentTime + 2 / 1000; // 2ms into the future
      }

      // each block has a 10ms size
      if (this.isApuEnabled()) {
        source.start(this.firstBlockStartTime + this.samplesSubmitted / 44100);
        // we'll stop the source to avoid overlaps
        source.stop(this.firstBlockStartTime + (this.samplesSubmitted + 440) / 44100);
      }

      this.samplesSubmitted += 441; // we're rounding here to keep things simple

      // reset buffers
      this.globalBufferLeft.length = 0;
      this.globalBufferRight.length = 0;
    }
  }

  writeAudioMasterControl(value: number) {
    // only the global on off bit is writeable, the rest is read only
    this.NR52 = this.NR52 | (value & 0b1000_0000);
    if (((value >> 7) & 0x1) === 0x1) {
      console.log("master audio switched on");
    } else {
      console.log("master audio switched off");
    }
  }

  isApuEnabled(): boolean {
    return ((this.NR52 >> 7) & 0x1) === 0x1;
  }

  readAudioMasterControl() {
    return this.NR52;
  }

  writeAudioChannelPanning(value: number) {
    this.NR51 = value & 0xff;
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
    const initialLength = this.NR11 & 0b111111;
    this.channel1SampleGenerator.setInitialLength(initialLength);
    const waveDuty = (this.NR11 >> 6) & 0b11;
    this.channel1SampleGenerator.setDutyCycle(waveDuty);
  }

  readChannel1Duty() {
    // the initial length timer is write only
    return this.NR11 & 0b11000000;
  }

  writeChannel1VolumeAndEnvelope(value: number) {
    this.NR12 = value & 0xff;

    // Other fields (not used in this function):
    const sweepPace = this.NR12 & 0b111;
    this.channel1SampleGenerator.setEnvelopeSweepPace(sweepPace);
    const envelopeDirection: EnvelopeDirection = ((this.NR12 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
    this.channel1SampleGenerator.setEnvelopeDirection(envelopeDirection);
    // not updated by envelope
    const initialVolume = (this.NR12 >> 4) & 0b1111;
    this.channel1SampleGenerator.setEnvelopeInitialVolume(initialVolume);

    // Turn off if env direction is down and initial length is zero
    if (this.NR12 >> 3 === 0) {
      this.channel1SampleGenerator.turnOff();
    }
  }

  readChannel1VolumeAndEnvelope() {
    return this.NR12;
  }

  writeChannel1PeriodLow(value: number) {
    this.NR13 = value & 0xff;
    const period = ((this.NR14 & 0b111) << 8) | (this.NR13 & 0xff);
    this.channel1SampleGenerator.setPeriod(period);
  }

  writeChannel1PeriodHighAndControl(value: number) {
    this.NR14 = value & 0xff;
    const trigger = (this.NR14 >> 7) & 0x1;

    const period = ((this.NR14 & 0b111) << 8) | (this.NR13 & 0xff);
    this.channel1SampleGenerator.setPeriod(period);

    const lengthEnabled = ((value >> 6) & 0x1) === 0x1;
    this.channel1SampleGenerator.setLengthEnabled(lengthEnabled);

    if (trigger) {
      const sweepPace = (this.NR10 >> 4) & 0b111;
      const sweepDirection = ((this.NR10 >> 3) & 0x1) === 0x1 ? "DOWN" : "UP";
      const sweepIndividualStep = this.NR10 & 0b111;
      this.channel1SampleGenerator.trigger({ sweepPace, sweepDirection, sweepIndividualStep });
    }
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
    const initialLength = this.NR21 & 0b111111;
    this.channel2SampleGenerator.setInitialLength(initialLength);
    const waveDuty = (this.NR21 >> 6) & 0b11;
    this.channel2SampleGenerator.setDutyCycle(waveDuty);
  }

  readChannel2Duty() {
    // the initial length timer is write only
    return this.NR21 & 0b11000000;
  }

  writeChannel2VolumeAndEnvelope(value: number) {
    this.NR22 = value & 0xff;
    // Other fields (not used in this function):
    const sweepPace = this.NR22 & 0b111;
    this.channel2SampleGenerator.setEnvelopeSweepPace(sweepPace);
    const envelopeDirection: EnvelopeDirection = ((this.NR22 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
    this.channel2SampleGenerator.setEnvelopeDirection(envelopeDirection);
    // not updated by envelope
    const initialVolume = (this.NR22 >> 4) & 0b1111;
    this.channel2SampleGenerator.setEnvelopeInitialVolume(initialVolume);

    // Turn off if env direction is down and initial length is zero
    if (this.NR22 >> 3 === 0) {
      this.channel2SampleGenerator.turnOff();
    }
  }

  readChannel2VolumeAndEnvelope() {
    return this.NR22;
  }

  writeChannel2PeriodLow(value: number) {
    this.NR23 = value & 0xff;
    const period = ((this.NR24 & 0b111) << 8) | (this.NR23 & 0xff);
    this.channel2SampleGenerator.setPeriod(period);
  }

  writeChannel2PeriodHighAndControl(value: number) {
    this.NR24 = value & 0xff;
    const trigger = (this.NR24 >> 7) & 0x1;

    const period = ((this.NR24 & 0b111) << 8) | (this.NR23 & 0xff);
    this.channel2SampleGenerator.setPeriod(period);

    const lengthEnabled = ((value >> 6) & 0x1) === 0x1;
    this.channel2SampleGenerator.setLengthEnabled(lengthEnabled);

    if (trigger) {
      this.channel2SampleGenerator.trigger();
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
      this.channel3SampleGenerator.enable();
    } else {
      this.channel3SampleGenerator.disable();
    }
  }

  readChannel3DACOnOff() {
    return this.NR30 & 0x8;
  }

  // FF1B - NR 31 length timer / write only
  writeChannel3LengthTimer(value: number) {
    this.NR31 = value & 0xff;
    this.channel3SampleGenerator.setInitialLength(this.NR31);
  }

  // FF1C - NR 32 output level
  writeChannel3OutputLevel(value: number) {
    this.NR32 = value & 0xff;
    const outputLevel = (this.NR32 >> 5) & 0b11;
    const channel3Volumes = [0, 1, 0.5, 0.25];
    this.channel3SampleGenerator.setVolume(channel3Volumes[outputLevel]);
  }

  readChannel3OutputLevel() {
    return this.NR32;
  }

  // FF1D - NR 33 channel 3 period low
  writeChannel3PeriodLow(value: number) {
    this.NR33 = value & 0xff;
    const period = ((this.NR34 & 0b111) << 8) | (this.NR33 & 0xff);
    this.channel3SampleGenerator.setPeriod(period);
  }

  // FF1E - NR34 channel 3 period high and control
  writeChannel3PeriodHighAndControl(value: number) {
    this.NR34 = value & 0xff;
    const trigger = ((this.NR34 >> 7) & 0x1) === 0x1;

    const period = ((this.NR34 & 0b111) << 8) | (this.NR33 & 0xff);
    this.channel3SampleGenerator.setPeriod(period);

    const lengthEnabled = ((value >> 6) & 0x1) === 0x1;
    this.channel3SampleGenerator.setLengthEnabled(lengthEnabled);

    if (trigger) {
      this.channel3SampleGenerator.trigger();
    }
  }

  readChannel3Control() {
    return this.NR34 & 0b0100_0000;
  }

  // FF30-FF3F 16 bytes wave pattern
  writeChannel3WavePattern(address: number, value: number) {
    this.FE30toFE3F[address] = value & 0xff;
    this.channel3SampleGenerator.setSamples(this.FE30toFE3F);
  }

  readChannel3WavePattern(address: number) {
    return this.FE30toFE3F[address];
  }

  // Channel 4, noise channel
  writeChannel4Length(value: number): void {
    this.NR41 = value & 0b11_1111;
    this.channel4SampleGenerator.setInitialLengthTimer(this.NR41);
  }

  writeChannel4VolumeAndEnvelope(value: number) {
    this.NR42 = value & 0xff;
    const sweepPace = this.NR42 & 0b111;
    this.channel4SampleGenerator.setEnvelopeSweepPace(sweepPace);
    const envelopeDirection: EnvelopeDirection = ((this.NR42 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
    this.channel4SampleGenerator.setEnvelopeDirection(envelopeDirection);
    // not updated by envelope
    const initialVolume = (this.NR42 >> 4) & 0b1111;
    this.channel4SampleGenerator.setEnvelopeInitialVolume(initialVolume);

    // Turn off if env direction is down and initial length is zero
    if (this.NR42 >> 3 === 0) {
      this.channel4SampleGenerator.turnOff();
    }
  }

  readChannel4VolumeAndEnvelope() {
    return this.NR42;
  }

  writeChannel4FrequencyAndRandomness(value: number) {
    this.NR43 = value & 0xff;

    this.channel4ClockShift = (value >> 4) & 0xf;
    this.channel4SampleGenerator.setClockShift((value >> 4) & 0xf);

    this.channel4LfsrWidth = ((value >> 3) & 0x1) === 0x1 ? 7 : 15;
    this.channel4SampleGenerator.setLfsrWidth(((value >> 3) & 0x1) === 0x1 ? 7 : 15);

    this.channel4ClockDivider = (value & 0b111) === 0 ? 0.5 : value & 0b111;
    this.channel4SampleGenerator.setLsfrClockDivider((value & 0b111) === 0 ? 0.5 : value & 0b111);
  }

  readChannel4FrequencyAndRandomness() {
    return this.NR43;
  }

  // FF43 - NR44
  writeChannel4Control(value: number) {
    this.NR44 = value & 0xff;

    const trigger = (this.NR44 >> 7) & 0x1;
    const lengthEnabled = ((value >> 6) & 0x1) === 0x1;
    this.channel4SampleGenerator.setLengthEnabled(lengthEnabled);

    // any value triggers this channel
    if (trigger) {
      this.channel4SampleGenerator.trigger();
    }
  }
  readChannel4LengthEnable() {
    return this.NR44 & 0b01000000;
  }

  // Supporting proper pcm based on channel 3 ticks would require some refactoring to the audio engine
  channel3Tick() {}
}
