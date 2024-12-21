/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/gameboy/apu.ts":
/*!****************************!*\
  !*** ./src/gameboy/apu.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.APUImpl = void 0;
/**
 * Quick and hacky APU implementation, lacks a bunch of features:
 * -> phasing not implemented
 * -> no support for proper PCM sampling (would require major refactor)
 * -> frequency change without trigger not implemented
 * -> stereo support not implemented (left/right volumes)
 * */
var APUImpl = /** @class */ (function () {
    function APUImpl() {
        this.audioContext = new AudioContext();
        // This is our own addition to control master volume
        this.deafultVolume = 0.2;
        this.volume = this.deafultVolume;
        // FF26 - NR52 - master audio control
        this.NR52 = 0x00;
        // FF25 - NR51 - panning
        this.NR51 = 0x00;
        // FF24 - NR50 - master volume (and vin panning which we ignore)
        this.NR50 = 0x00;
        // FF10 - NR10 Channel 1 Sweep
        this.NR10 = 0x00;
        // FF11 - NR11 Channel 1 length timer and duty cycle
        this.NR11 = 0x00;
        // FF12 - NR12 channel 1 volume and envelope
        this.NR12 = 0x00;
        // FF13 - NR13 channel 1 period low write only
        this.NR13 = 0x00;
        // FF14 - NR14 channel 1 period high & control
        this.NR14 = 0x00;
        // FF16 - NR 21 (equivalent to NR11)
        this.NR21 = 0x00;
        // FF17 - NR 22 (equivalent to NR12)
        this.NR22 = 0x00;
        // FF18 - NR 23 (equivalent to NR13)
        this.NR23 = 0x00;
        // FF19 - NR 24 (equivalent to NR14)
        this.NR24 = 0x00;
        // FF1A - NR 30 DAC on/off
        this.NR30 = 0x00;
        // FF1B - NR 31 length timer / write only
        this.NR31 = 0x00;
        // FF1C - NR 32 output level
        this.NR32 = 0x00;
        // FF1D - NR 33 channel 3 period low
        this.NR33 = 0x00;
        // FF1E - NR34 channel 3 period high and control
        this.NR34 = 0x00;
        // FF30-FF3F 16 bytes wave pattern
        this.FE30toFE3F = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        // Noise channel
        // FF20 - NR 41, channel 4 length, write only
        this.NR41 = 0x00;
        // FF21 - NR 42 channel 4 volume and envelope
        this.NR42 = 0x00;
        // FF22 - NR 43, frequency + randomness
        this.NR43 = 0x00;
        // FF23 - NR 44
        this.NR44 = 0x00;
        this.channel4ClockShift = 0;
        this.channel4LfsrWidth = 15;
        this.channel4ClockDivider = 0.5;
        this.envelopeTickCounter = 0;
        this.soundLengthTickCounter = 0;
        this.channel1SweepTickCounter = 0;
        this.noiseChannelClockIncreaseCounter = 0;
        this.audioStartTime = 0;
        this.totalNumberOfSamplesSubmitted = 0;
        this.mainOutSampleIndex = 0;
        this.mainOutSamples = [];
        this.channel1Samples = [];
        this.channel1SampleIndex = 0;
        this.channel1Volume = 0;
        this.channel2Samples = [];
        this.channel2SampleIndex = 0;
        this.channel2Volume = 0;
        this.channel3Samples = [0];
        this.channel3SampleIndex = 0;
        this.channel3Volume = 0;
        this.channel3IsOn = false;
        this.channel3WaveSampleIndex = 0;
        this.bufferAhead = 0.05;
        this.channel4Volume = 0;
        this.channel4IsOn = false;
        // we'll apply a mini envolope to each newly triggered sound
        // these will be reset by a trigger
        this.envelopes = [0, 0, 0, 0];
        this.channel1EnvelopModulo = 0;
        this.channel2EnvelopModulo = 0;
        this.channel4EnvelopModulo = 0;
        this.sweepModulo = 0;
        this.channel3SampleChanged = false;
        this.sweepPace = 0;
        this.channel3Volumes = [0, 1, 0.5, 0.25];
        // We're pre-generating these
        this.channel4LfsrState = Math.pow(2, this.channel4LfsrWidth) - 1;
        // fill our round robin audio buffers up with 0
        for (var i = 0; i < 3 * this.audioContext.sampleRate; i++) {
            this.mainOutSamples[i] = 0;
        }
    }
    APUImpl.prototype.mute = function () {
        this.volume = 0;
    };
    APUImpl.prototype.unmute = function () {
        this.volume = this.deafultVolume;
    };
    // This is being called 1048576 times per second
    APUImpl.prototype.tick = function () {
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
            var time = this.audioContext.currentTime;
            var totalTimePassed = time - this.audioStartTime;
            var samplesToSubmit = (totalTimePassed + this.bufferAhead) * this.audioContext.sampleRate - this.totalNumberOfSamplesSubmitted;
            if (samplesToSubmit > 0) {
                var buffer = this.audioContext.createBuffer(1, samplesToSubmit, // check this math, seems to be way off
                this.audioContext.sampleRate);
                var nowBuffering = buffer.getChannelData(0);
                // clock the noise channel based on the buffer length
                var lfsrClockFrequencey = 262144 / (this.channel4ClockDivider * (1 << this.channel4ClockShift)); // 1048576 / 4 = 262144
                var samplesAfterWeNeedToClock = Math.round(this.audioContext.sampleRate / lfsrClockFrequencey); // Todo: for very fast lfsr clocks we need to sample multiple times per sample
                var numberOfClocksPerSample = 1;
                if (samplesAfterWeNeedToClock === 0) {
                    numberOfClocksPerSample = Math.round(lfsrClockFrequencey / this.audioContext.sampleRate);
                }
                for (var i = 0; i < buffer.length; i++) {
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
                        var nextSample = this.channel3Samples[this.channel3SampleIndex];
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
                        }
                        else {
                            // one sample clocks the lfsr multiple times
                            for (var i_1 = 0; i_1 < numberOfClocksPerSample; i_1++) {
                                this.getNextLFSRSample();
                            }
                        }
                        var noiseOuput = this.channel4LfsrState & 1;
                        this.mainOutSamples[this.mainOutSampleIndex] =
                            this.mainOutSamples[this.mainOutSampleIndex] +
                                noiseOuput * (this.channel4Volume / 15 / 4) * this.envelopes[3];
                    }
                    // copy main samples into buffer
                    nowBuffering[i] = this.mainOutSamples[this.mainOutSampleIndex] * this.volume;
                    this.mainOutSampleIndex = (this.mainOutSampleIndex + 1) % this.mainOutSamples.length;
                    // not really needed
                    for (var i_2 = 0; i_2 < this.envelopes.length; i_2++) {
                        if (this.envelopes[i_2] < 1) {
                            this.envelopes[i_2] = this.envelopes[i_2] + 1;
                        }
                    }
                }
                var source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(this.audioContext.destination);
                // one blob should be played for 1/64 of a second
                var nextTime = this.audioStartTime + this.totalNumberOfSamplesSubmitted / this.audioContext.sampleRate;
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
    };
    APUImpl.prototype.handleChannel1Envelope = function () {
        var sweepPace = this.NR12 & 7;
        if (sweepPace === 0) {
            return;
        }
        if (this.channel1EnvelopModulo === 0) {
            var envelopeDirection = ((this.NR12 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
            if (envelopeDirection === "INCREASE" && this.channel1Volume < 15) {
                this.channel1Volume++;
            }
            else if (envelopeDirection === "DECREASE" && this.channel1Volume > 0) {
                this.channel1Volume--;
            }
        }
        this.channel1EnvelopModulo = (this.channel1EnvelopModulo + 1) % sweepPace;
    };
    APUImpl.prototype.handleChannel2Envelope = function () {
        var sweepPace = this.NR22 & 7;
        if (sweepPace === 0) {
            return;
        }
        if (this.channel2EnvelopModulo === 0) {
            var envelopeDirection = ((this.NR22 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
            if (envelopeDirection === "INCREASE" && this.channel2Volume < 15) {
                this.channel2Volume++;
            }
            else if (envelopeDirection === "DECREASE" && this.channel2Volume > 0) {
                this.channel2Volume--;
            }
        }
        this.channel2EnvelopModulo = (this.channel2EnvelopModulo + 1) % sweepPace;
    };
    APUImpl.prototype.handleChannel4Envelope = function () {
        var sweepPace = this.NR42 & 7;
        if (sweepPace === 0) {
            return;
        }
        if (this.channel4EnvelopModulo === 0) {
            var envelopeDirection = ((this.NR42 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
            if (envelopeDirection === "INCREASE" && this.channel4Volume < 15) {
                this.channel4Volume++;
            }
            else if (envelopeDirection === "DECREASE" && this.channel4Volume > 0) {
                this.channel4Volume--;
            }
        }
        this.channel4EnvelopModulo = (this.channel4EnvelopModulo + 1) % sweepPace;
    };
    APUImpl.prototype.handleChannel1Length = function () {
        var lengthEnable = (this.NR14 >> 6) & 0x1;
        if (!lengthEnable) {
            return;
        }
        var channel1Length = this.NR11 & 63;
        channel1Length++;
        if (channel1Length >= 64) {
            // cut off channel
            this.channel1Samples = [0];
            this.channel1SampleIndex = 0;
        }
        this.NR11 = (this.NR11 & 0) | (channel1Length & 63);
    };
    APUImpl.prototype.handleChannel2Length = function () {
        var lengthEnable = (this.NR24 >> 6) & 0x1;
        if (!lengthEnable) {
            return;
        }
        var channel2Length = this.NR21 & 63;
        channel2Length++;
        if (channel2Length >= 64) {
            // cut off channel
            this.channel2Samples = [0];
            this.channel2SampleIndex = 0;
        }
        this.NR21 = (this.NR21 & 0) | (channel2Length & 63);
    };
    // 8 bit length for channel 3 in contrast to the others
    APUImpl.prototype.handleChannel3Length = function () {
        var lengthEnable = (this.NR34 >> 6) & 0x1;
        if (!lengthEnable) {
            return;
        }
        var channel3Length = this.NR31;
        channel3Length++;
        if (channel3Length >= 64) {
            // cut off channel
            this.channel3IsOn = false;
        }
        this.NR31 = channel3Length & 0xff;
    };
    APUImpl.prototype.handleChannel4Length = function () {
        var lengthEnable = (this.NR44 >> 6) & 0x1;
        if (!lengthEnable) {
            return;
        }
        var channel4Length = this.NR41 & 63;
        channel4Length++;
        if (channel4Length >= 64) {
            // cut off channel
            this.channel4IsOn = false;
        }
        this.NR41 = (this.NR41 & 0) | (channel4Length & 63);
    };
    APUImpl.prototype.hanldeChannel1Sweep = function () {
        // Number of iterations in 128 hz ticks (7.8 ms), field not re-read until finished!
        // 0 written to 0, sweep instantly stops
        if (this.sweepPace === 0) {
            return;
        }
        if (this.sweepModulo === 0) {
            var step = this.NR10 & 7;
            var direction = ((this.NR10 >> 3) & 0x1) === 0x0 ? "UP" : "DOWN";
            var period = ((this.NR14 & 7) << 8) | (this.NR13 & 0xff);
            if (direction === "UP") {
                console.log("up");
                period = period + period / (1 << step);
            }
            else {
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
            this.NR14 = (this.NR14 & 248) | (period >> 8);
            this.updateChannel1Samples(period);
        }
        this.sweepModulo = (this.sweepModulo + 1) % this.sweepPace;
    };
    APUImpl.prototype.updateChannel1Samples = function (period) {
        var pediodLength = 2048 - period;
        // 1048576 / 8 because 8 samples per wave form
        var frequency = 1048576 / 8 / pediodLength;
        var sampleRate = this.audioContext.sampleRate;
        var samplesPerWave = sampleRate / frequency;
        this.channel1Samples = [];
        this.channel1SampleIndex = 0;
        // we could also implement a ring buffer here
        for (var i = 0; i < samplesPerWave; i++) {
            // audio needs to be in [-1.0; 1.0]
            // Todo: for now we're just using a perfect square wave to keeps things simple,
            // in reality, these could have different phases, based on 0xFF11.
            this.channel1Samples[i] = Math.round(i / samplesPerWave) * 2 - 1;
        }
    };
    APUImpl.prototype.updateChannel2Samples = function (period) {
        var pediodLength = 2048 - period;
        // 1048576 / 8 because 8 samples per wave form
        var frequency = 1048576 / 8 / pediodLength;
        var sampleRate = this.audioContext.sampleRate;
        var samplesPerWave = sampleRate / frequency;
        this.channel2Samples = [];
        this.channel2SampleIndex = 0;
        // we could also implement a ring buffer here
        for (var i = 0; i < samplesPerWave; i++) {
            // audio needs to be in [-1.0; 1.0]
            // Todo: for now we're just using a perfect square wave,
            // same as for channel 1
            this.channel2Samples[i] = Math.round(i / samplesPerWave) * 2 - 1;
        }
    };
    // We're not fully supporting PCM here since that would require a
    // major refactoring of the entire audio playback to keep all
    // channels in sync.
    APUImpl.prototype.updateChannel3Samples = function (period) {
        this.channel3Samples = [0, 0];
        this.channel3SampleIndex = 1; // wave usually starts at 1
        var frequency = 65536 / (2048 - period);
        var samplesRequired = this.audioContext.sampleRate / frequency;
        for (var i = 0; i < samplesRequired; i++) {
            // 32 samples
            var sampleIndex = (31 / samplesRequired) * i;
            var sample = this.getChannel3WaveSampleAtIndex(i);
            this.channel3Samples[i] = sample;
        }
    };
    APUImpl.prototype.deleteMe = function () {
        if (!this.channel3SampleChanged) {
            return;
        }
        var outputLevel = (this.NR32 >> 5) & 3;
        this.channel3Volume = this.channel3Volumes[outputLevel];
        var period = ((this.NR34 & 7) << 8) | (this.NR33 & 0xff);
        this.channel3Samples = [0, 0];
        var frequency = 65536 / (2048 - period);
        var samplesRequired = this.audioContext.sampleRate / frequency;
        for (var i = 0; i < samplesRequired; i++) {
            // 32 samples
            var sampleIndex = (31 / samplesRequired) * i;
            var sample = this.getChannel3WaveSampleAtIndex(i);
            this.channel3Samples[i] = sample;
        }
        if (this.channel3SampleIndex >= samplesRequired) {
            this.channel3SampleIndex = 1;
        }
    };
    APUImpl.prototype.getChannel3WaveSampleAtIndex = function (index) {
        var channel3WavePattern = this.FE30toFE3F;
        var nibble = index % 2 === 0 ? "HIGH" : "LOW";
        var sample = 0;
        if (nibble === "HIGH") {
            sample = channel3WavePattern[Math.round(index / 2)] >> 4;
        }
        else {
            sample = channel3WavePattern[Math.round(index / 2)] & 0xf;
        }
        return (sample / 15) * 2 - 1; // move it so that it's between -1 and 1
    };
    APUImpl.prototype.writeAudioMasterControl = function (value) {
        // only the global on off bit is writeable, the rest is read only
        this.NR52 = this.NR52 | (value & 64);
        if (((value >> 7) & 0x1) === 0x1) {
            console.log("master audio switched on");
        }
        else {
            console.log("master audio switched off");
        }
    };
    APUImpl.prototype.readAudioMasterControl = function () {
        return this.NR52;
    };
    APUImpl.prototype.writeAudioChannelPanning = function (value) {
        this.NR51 = value & 0xff;
        // mute channels if panning is off on both sides
        // channel 1
        // right && left
        if (!(this.NR51 & 1) && !(this.NR51 & 16)) {
            this.channel1Volume = 0;
        }
        // channel 2
        // right && left
        if (!(this.NR51 & 2) && !(this.NR51 & 32)) {
            this.channel2Volume = 0;
        }
        // channel 3
        // right && left
        if (!(this.NR51 & 4) && !(this.NR51 & 64)) {
            this.channel3Volume = 0;
        }
        // channel 4
        // right && left
        if (!(this.NR51 & 8) && !(this.NR51 & 128)) {
            this.channel4Volume = 0;
        }
    };
    APUImpl.prototype.readAudioChannelPanning = function () {
        return this.NR51;
    };
    APUImpl.prototype.writeMasterVolume = function (value) {
        this.NR50 = value & 0xff;
    };
    APUImpl.prototype.readMasterVolume = function () {
        return this.NR50;
    };
    APUImpl.prototype.getVolumeRight = function () {
        return this.NR50 & 7;
    };
    APUImpl.prototype.getVolumeLeft = function () {
        return (this.NR50 >> 4) & 7;
    };
    APUImpl.prototype.writeChannel1Sweep = function (value) {
        this.NR10 = value & 0xff;
        // const step = this.NR10 & 0b111;
        // const direction: SweepDirection = this.NR10 >> 3 === 0x0 ? "UP" : "DOWN";
        // Number of iterations in 128 hz ticks (7.8 ms), field not re-read until finished!
        // 0 written to 0, sweep instantly stops
        var pace = (this.NR10 >> 4) & 7;
        this.sweepPace = pace;
    };
    APUImpl.prototype.readChannel1Sweep = function () {
        return this.NR10;
    };
    APUImpl.prototype.writeChannel1LengthAndDuty = function (value) {
        this.NR11 = value & 0xff;
        // the higher the value the shorter before the signal is cut
        // write only
        // Other fields (not used in this function):
        // const initialLength = this.NR11 & 0b111111;
        // const waveDuty = (this.NR11 >> 6) & 0b11;
    };
    APUImpl.prototype.readChannel1Duty = function () {
        // the initial length timer is write only
        return this.NR11 & 192;
    };
    APUImpl.prototype.writeChannel1VolumeAndEnvelope = function (value) {
        this.NR12 = value & 0xff;
        // Other fields (not used in this function):
        // const sweepPace = this.NR12 & 0b111;
        // const envelopeDirection: EnvelopeDirection =
        //   ((this.NR12 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
        // // not updated by envelope
        // const initialVolume = (this.NR12 >> 4) & 0b1111;
    };
    APUImpl.prototype.readChannel1VolumeAndEnvelope = function () {
        return this.NR12;
    };
    APUImpl.prototype.writeChannel1PeriodLow = function (value) {
        this.NR13 = value & 0xff;
        // Todo: normally we should update the period here too
    };
    APUImpl.prototype.writeChannel1PeriodHighAndControl = function (value) {
        this.NR14 = value & 0xff;
        var trigger = (this.NR14 >> 7) & 0x1;
        if (trigger) {
            this.envelopes[0] = 0;
            var initialVolume = (this.NR12 >> 4) & 15;
            this.channel1Volume = initialVolume;
            var period = ((this.NR14 & 7) << 8) | (this.NR13 & 0xff);
            this.updateChannel1Samples(period);
        }
        // Todo: we should always update the period here but that would require
        // a different buffer handling approach.
    };
    APUImpl.prototype.readChannel1LengthEnable = function () {
        // trigger and period are write only values
        return this.NR14 & 64;
    };
    APUImpl.prototype.writeChannel2LengthAndDuty = function (value) {
        this.NR21 = value & 0xff;
        // the higher the value the shorter before the signal is cut
        // write only
        // Other fields (not used in this function):
        // const initialLength = this.NR21 & 0b111111;
        // const waveDuty = (this.NR21 >> 6) & 0b11;
        // console.log(`Channel one length ${initialLength}, wave duty: ${waveDuty}`);
    };
    APUImpl.prototype.readChannel2Duty = function () {
        // the initial length timer is write only
        return this.NR21 & 192;
    };
    APUImpl.prototype.writeChannel2VolumeAndEnvelope = function (value) {
        this.NR22 = value & 0xff;
        var sweepPace = this.NR22 & 7;
        var envelopeDirection = ((this.NR22 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
        // Other fields (not used in this function):
        // not updated by envelope
        // const initialVolume = (this.NR22 >> 4) & 0b1111;
    };
    APUImpl.prototype.readChannel2VolumeAndEnvelope = function () {
        return this.NR22;
    };
    APUImpl.prototype.writeChannel2PeriodLow = function (value) {
        this.NR23 = value & 0xff;
        // Other fields (not used in this function):
        // const periodBitsLow = this.NR23;
    };
    APUImpl.prototype.writeChannel2PeriodHighAndControl = function (value) {
        this.NR24 = value & 0xff;
        var trigger = (this.NR24 >> 7) & 0x1;
        // any value triggers this channel
        if (trigger) {
            // console.log('channel 2 triggred');
            this.envelopes[1] = 0;
            var period = ((this.NR24 & 7) << 8) | (this.NR23 & 0xff);
            var initialVolume = (this.NR22 >> 4) & 15;
            this.channel2Volume = initialVolume;
            // Todo: this should just be the same as 2048 - period value
            // const periodLenghtInTicks = signedFrom11Bits(period);
            this.updateChannel2Samples(period);
        }
    };
    APUImpl.prototype.readChannel2LengthEnable = function () {
        // trigger and period are write only values
        return this.NR24 & 64;
    };
    // Channel 3, custom wave
    // FF1A - NR 30 DAC on/off
    APUImpl.prototype.writeChannel3DACOnOff = function (value) {
        this.NR30 = value & 0x8;
        if ((this.NR30 >> 7 && 1) === 1) {
            this.channel3IsOn = true;
        }
        else {
            this.channel3IsOn = false;
            this.channel3Volume = 0;
        }
    };
    APUImpl.prototype.readChannel3DACOnOff = function () {
        return this.NR30 & 0x8;
    };
    // FF1B - NR 31 length timer / write only
    APUImpl.prototype.writeChannel3LengthTimer = function (value) {
        this.NR31 = value & 0xff;
    };
    // FF1C - NR 32 output level
    APUImpl.prototype.writeChannel3OutputLevel = function (value) {
        this.NR32 = value & 0xff;
        var outputLevel = (this.NR32 >> 5) & 3;
        this.channel3Volume = this.channel3Volumes[outputLevel];
    };
    APUImpl.prototype.readChannel3OutputLevel = function () {
        return this.NR32;
    };
    // FF1D - NR 33 channel 3 period low
    APUImpl.prototype.writeChannel3PeriodLow = function (value) {
        this.NR33 = value & 0xff;
    };
    // FF1E - NR34 channel 3 period high and control
    APUImpl.prototype.writeChannel3PeriodHighAndControl = function (value) {
        this.NR34 = value & 0xff;
        var trigger = (this.NR34 >> 7) & 0x1;
        // any value triggers this channel
        if (trigger) {
            // console.log('channel 3 triggred');
            this.envelopes[2] = 0;
            var period = ((this.NR34 & 7) << 8) | (this.NR33 & 0xff);
            var outputLevel = (this.NR32 >> 5) & 3;
            this.channel3Volume = this.channel3Volumes[outputLevel];
            this.channel3IsOn = true;
            this.channel3WaveSampleIndex = 1;
            this.updateChannel3Samples(period);
        }
    };
    APUImpl.prototype.readChannel3Control = function () {
        return this.NR34 & 64;
    };
    // FF30-FF3F 16 bytes wave pattern
    APUImpl.prototype.writeChannel3WavePattern = function (address, value) {
        this.channel3SampleChanged = true;
        // todo: put this back in
        this.FE30toFE3F[address] = value & 0xff;
    };
    APUImpl.prototype.readChannel3WavePattern = function (address) {
        return this.FE30toFE3F[address];
    };
    APUImpl.prototype.getNextChannel3WaveSample = function () {
        var channel3WavePattern = this.FE30toFE3F;
        var nibble = this.channel3WaveSampleIndex % 2 === 0 ? "HIGH" : "LOW";
        var sample = 0;
        if (nibble === "HIGH") {
            sample = channel3WavePattern[Math.round(this.channel3WaveSampleIndex / 2)] >> 4;
        }
        else {
            sample = channel3WavePattern[Math.round(this.channel3WaveSampleIndex / 2)] & 0xf;
        }
        sample = (sample / 15) * 2 - 1; // move it so that it's between -1 and 1
        this.channel3WaveSampleIndex = (this.channel3WaveSampleIndex + 1) % 32; // 32 samples in the buffer
        return sample;
    };
    // Channel 4, noise channel
    APUImpl.prototype.writeChannel4Length = function (value) {
        this.NR41 = value & 63;
    };
    APUImpl.prototype.writeChannel4VolumeAndEnvelope = function (value) {
        this.NR42 = value & 0xff;
        var sweepPace = this.NR42 & 7;
        var envelopeDirection = ((this.NR42 >> 3) & 0x1) === 1 ? "INCREASE" : "DECREASE";
        // not updated by envelope
        var initialVolume = (this.NR42 >> 4) & 15;
    };
    APUImpl.prototype.readChannel4VolumeAndEnvelope = function () {
        return this.NR42;
    };
    APUImpl.prototype.writeChannel4FrequencyAndRandomness = function (value) {
        this.NR43 = value & 0xff;
        this.channel4ClockShift = (value >> 4) & 0xf;
        this.channel4LfsrWidth = ((value >> 3) & 0x1) === 0x1 ? 7 : 15;
        this.channel4ClockDivider = (value & 7) === 0 ? 0.5 : value & 7;
    };
    APUImpl.prototype.readChannel4FrequencyAndRandomness = function () {
        return this.NR43;
    };
    // FF43 - NR44
    APUImpl.prototype.writeChannel4Control = function (value) {
        this.NR44 = value & 0xff;
        var trigger = (this.NR44 >> 7) & 0x1;
        // any value triggers this channel
        if (trigger) {
            this.envelopes[3] = 0;
            var initialVolume = (this.NR42 >> 4) & 15;
            this.channel4Volume = initialVolume;
            this.channel4IsOn = true;
        }
    };
    APUImpl.prototype.readChannel4LengthEnable = function () {
        return this.NR44 & 64;
    };
    APUImpl.prototype.getNextLFSRSample = function () {
        var result = this.channel4LfsrState & 1;
        var oneBeforeLast = (this.channel4LfsrState >> 1) & 1;
        this.channel4LfsrState = (this.channel4LfsrState >> 1) | ((result ^ oneBeforeLast) << (this.channel4LfsrWidth - 1));
        return result;
    };
    // Supporting proper pcm based on channel 3 ticks would require some refactoring to the audio engine
    APUImpl.prototype.channel3Tick = function () { };
    return APUImpl;
}());
exports.APUImpl = APUImpl;


/***/ }),

/***/ "./src/gameboy/bus.ts":
/*!****************************!*\
  !*** ./src/gameboy/bus.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.BusImpl = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/gameboy/utils.ts");
/**
 * Simple bus implementation. Known issues:
 * - missing proper serial support (serial reads) for multiplayer games
 * - we haven't implemented some PPU reads
 */
var BusImpl = /** @class */ (function () {
    function BusImpl(cart, ram, interrupts, ppu, serial, timer, writeFF46, joypad, apu) {
        this.cart = cart;
        this.ram = ram;
        this.interrupts = interrupts;
        this.ppu = ppu;
        this.serial = serial;
        this.timer = timer;
        this.writeFF46 = writeFF46;
        this.joypad = joypad;
        this.apu = apu;
        this.debugging = false;
    }
    BusImpl.prototype.read = function (address, skipDebugging) {
        if (skipDebugging === void 0) { skipDebugging = false; }
        var result = 0;
        // 16 KiB ROM bank 00	From cartridge, usually a fixed bank
        if (address >= 0x0000 && address <= 0x3fff) {
            result = this.cart.read(address);
        }
        // 16 KiB ROM Bank 01–NN	From cartridge, switchable bank via mapper (if any)
        else if (address >= 0x4000 && address <= 0x7fff) {
            result = this.cart.read(address);
        }
        // 8 KiB Video RAM (VRAM)	In CGB mode, switchable bank 0/1
        else if (address >= 0x8000 && address <= 0x9fff) {
            result = this.ppu.readVram(address - 0x8000);
        }
        // 8 KiB External RAM	From cartridge, switchable bank if any
        else if (address >= 0xa000 && address <= 0xbfff) {
            result = this.cart.read(address);
        }
        // 4 KiB Work RAM (WRAM)
        else if (address >= 0xc000 && address <= 0xdfff) {
            result = this.ram.readWorkingRam(address - 0xc000);
        }
        else if (address >= 0xe000 && address <= 0xfdff) {
            // Mirros the working ram but shouldn't be used acutally
            result = this.ram.readWorkingRam(address - 0xe000);
        }
        // Object attribute memory (OAM)
        else if (address >= 0xfe00 && address <= 0xfe9f) {
            result = this.ppu.readOAM(address - 0xfe00);
        }
        // Not Usable	Nintendo says use of this area is prohibited.
        else if (address >= 0xfea0 && address <= 0xfeff) {
            throw new Error("not usable area read for address " + (0, utils_1.toHexString)(address) + " not implemented");
        }
        // I/O Registers
        else if (address >= 0xff00 && address <= 0xff7f) {
            if (address === 0xff00) {
                result = this.joypad.getJOYP();
            }
            else if (address === 0xff01) {
                result = this.serial.readSB();
            }
            else if (address === 0xff02) {
                result = this.serial.readSC();
            }
            else if (address === 0xff04) {
                result = this.timer.getTimerDiv();
            }
            else if (address === 0xff05) {
                result = this.timer.getTimerCounter();
            }
            else if (address === 0xff0f) {
                result = this.interrupts.getInterruptFlag();
            }
            else if (address >= 0xff10 && address <= 0xff3f) {
                // Audio
                if (address === 0xff10) {
                    result = this.apu.readChannel1Sweep();
                }
                else if (address === 0xff11) {
                    result = this.apu.readChannel1Duty();
                }
                else if (address === 0xff12) {
                    result = this.apu.readChannel1VolumeAndEnvelope();
                }
                else if (address === 0xff13) {
                    result = 0x00; // write only
                }
                else if (address === 0xff14) {
                    result = this.apu.readChannel1LengthEnable();
                }
                else if (address === 0xff16) {
                    result = this.apu.readChannel2Duty();
                }
                else if (address === 0xff17) {
                    result = this.apu.readChannel2VolumeAndEnvelope();
                }
                else if (address === 0xff18) {
                    result = 0x00; // write only
                }
                else if (address === 0xff19) {
                    result = this.apu.readChannel2LengthEnable();
                }
                else if (address === 0xff1a) {
                    result = this.apu.readChannel3DACOnOff();
                }
                else if (address === 0xff1c) {
                    result = this.apu.readChannel3OutputLevel();
                }
                else if (address === 0xff1e) {
                    result = this.apu.readChannel3Control();
                }
                else if (address === 0xff20) {
                    // write only
                    result = 0x00;
                }
                else if (address === 0xff21) {
                    result = this.apu.readChannel4VolumeAndEnvelope();
                }
                else if (address === 0xff22) {
                    result = this.apu.readChannel4FrequencyAndRandomness();
                }
                else if (address === 0xff23) {
                    result = this.apu.readChannel4LengthEnable();
                }
                else if (address === 0xff24) {
                    result = this.apu.readMasterVolume();
                }
                else if (address === 0xff25) {
                    result = this.apu.readAudioChannelPanning();
                }
                else if (address === 0xff26) {
                    result = this.apu.readAudioMasterControl();
                }
                else if (address >= 0xff30 && address <= 0xff3f) {
                    result = this.apu.readChannel3WavePattern(address - 0xff30);
                }
                // ignore other audio reads
                result = 0x00;
            }
            else if (address === 0xff40) {
                result = this.ppu.readFF40();
            }
            else if (address === 0xff41) {
                result = this.ppu.readFF41();
            }
            else if (address === 0xff42) {
                result = this.ppu.readFF42();
            }
            else if (address === 0xff43) {
                result = this.ppu.readFF43();
            }
            else if (address === 0xff44) {
                result = this.ppu.readFF44();
            }
            else if (address === 0xff45) {
                result = this.ppu.readFF45();
            }
            else if (address === 0xff47) {
                result = this.ppu.readFF47();
            }
            else if (address === 0xff48) {
                result = this.ppu.readFF48();
            }
            else if (address === 0xff49) {
                result = this.ppu.readFF49();
            }
            else if (address === 0xff4a) {
                result = this.ppu.readFF4A();
            }
            else if (address === 0xff4b) {
                result = this.ppu.readFF4B();
            }
            else if (address === 0xff4d) {
                // Todo: speed switch?
                // throw Error("ff4d speed switch not implemented");
                result = 0xff;
            }
            else if (address === 0xff4f) {
                // we don't support vram bank selects, that's a GBC thing
                result = 0x0;
            }
            else {
                throw new Error("io read for address " + (0, utils_1.toHexString)(address) + " not implemented");
            }
        }
        // High RAM (HRAM)
        else if (address >= 0xff80 && address <= 0xfffe) {
            result = this.ram.readHighRam(address - 0xff80);
        }
        // Interrupt Enable register (IE)
        else if (address >= 0xffff && address <= 0xffff) {
            result = this.interrupts.getIE();
        }
        else {
            throw new Error("read outside of address space: " + (0, utils_1.toHexString)(address) + "");
        }
        if (this.debugging && !skipDebugging) {
            console.log("%cDebugger - bus: read value ".concat((0, utils_1.toHexString)(result), " from address ").concat((0, utils_1.toHexString)(address)), "background: #ffffff; color: #0000ff");
        }
        return result;
    };
    BusImpl.prototype.write = function (address, value, skipDebugging) {
        if (skipDebugging === void 0) { skipDebugging = false; }
        if (this.debugging && !skipDebugging) {
            console.log("%cDebugger - bus: writing ".concat((0, utils_1.toHexString)(value), " to address ").concat((0, utils_1.toHexString)(address)), "background: #ffffff; color: #ff0000");
        }
        // 16 KiB ROM bank 00	From cartridge, usually a fixed bank
        if (address >= 0x0000 && address <= 0x3fff) {
            this.cart.write(address, value);
            return;
        }
        // 16 KiB ROM Bank 01–NN	From cartridge, switchable bank via mapper (if any)
        if (address >= 0x4000 && address <= 0x7fff) {
            this.cart.write(address, value);
            return;
        }
        // 8 KiB Video RAM (VRAM)	In CGB mode, switchable bank 0/1
        if (address >= 0x8000 && address <= 0x9fff) {
            this.ppu.writeVram(address - 0x8000, value);
            return;
        }
        // 8 KiB External RAM	From cartridge, switchable bank if any
        if (address >= 0xa000 && address <= 0xbfff) {
            this.cart.write(address, value);
            return;
        }
        // 4 KiB Work RAM (WRAM)
        if (address >= 0xc000 && address <= 0xdfff) {
            this.ram.writeWorkingRam(address - 0xc000, value);
            return;
        }
        if (address >= 0xe000 && address <= 0xfdff) {
            // Mirros the working ram but shouldn't be used acutally
            this.ram.writeWorkingRam(address - 0xe000, value);
            return;
        }
        // Object attribute memory (OAM)
        if (address >= 0xfe00 && address <= 0xfe9f) {
            this.ppu.writeOAM(address - 0xfe00, value);
            return;
        }
        // Not Usable	Nintendo says use of this area is prohibited.
        if (address >= 0xfea0 && address <= 0xfeff) {
            // looks like a tetris is writing to it anyway, maybe a bug, https://www.reddit.com/r/EmuDev/comments/5nixai/gb_tetris_writing_to_unused_memory/
            return;
        }
        // I/O Registers
        if (address >= 0xff00 && address <= 0xff7f) {
            if (address === 0xff00) {
                this.joypad.setJOYP(value);
                return;
            }
            if (address === 0xff01) {
                // data
                this.serial.writeSB(value);
                return;
            }
            if (address === 0xff02) {
                // transfer control
                this.serial.writeSC(value);
                return;
            }
            if (address === 0xff05) {
                this.timer.setTimerCounter(value);
                return;
            }
            if (address === 0xff06) {
                this.timer.setTimerModulo(value);
                return;
            }
            if (address === 0xff07) {
                this.timer.setTAC(value);
                return;
            }
            if (address === 0xff0f) {
                this.interrupts.setInterruptFlag(value);
                return;
            }
            if (address >= 0xff10 && address <= 0xff3f) {
                // Audio
                if (address === 0xff10) {
                    this.apu.writeChannel1Sweep(value);
                    return;
                }
                if (address === 0xff11) {
                    this.apu.writeChannel1LengthAndDuty(value);
                    return;
                }
                if (address === 0xff12) {
                    this.apu.writeChannel1VolumeAndEnvelope(value);
                    return;
                }
                if (address === 0xff13) {
                    this.apu.writeChannel1PeriodLow(value);
                    return;
                }
                if (address === 0xff14) {
                    this.apu.writeChannel1PeriodHighAndControl(value);
                    return;
                }
                if (address === 0xff16) {
                    this.apu.writeChannel2LengthAndDuty(value);
                    return;
                }
                if (address === 0xff17) {
                    this.apu.writeChannel2VolumeAndEnvelope(value);
                    return;
                }
                if (address === 0xff18) {
                    this.apu.writeChannel2PeriodLow(value);
                    return;
                }
                if (address === 0xff19) {
                    this.apu.writeChannel2PeriodHighAndControl(value);
                    return;
                }
                if (address === 0xff1a) {
                    this.apu.writeChannel3DACOnOff(value);
                    return;
                }
                if (address === 0xff1b) {
                    this.apu.writeChannel3LengthTimer(value);
                    return;
                }
                if (address === 0xff1c) {
                    this.apu.writeChannel3OutputLevel(value);
                    return;
                }
                if (address === 0xff1d) {
                    this.apu.writeChannel3PeriodLow(value);
                    return;
                }
                if (address === 0xff1e) {
                    this.apu.writeChannel3PeriodHighAndControl(value);
                    return;
                }
                if (address === 0xff20) {
                    this.apu.writeChannel4Length(value);
                    return;
                }
                if (address === 0xff21) {
                    this.apu.writeChannel4VolumeAndEnvelope(value);
                    return;
                }
                if (address === 0xff22) {
                    this.apu.writeChannel4FrequencyAndRandomness(value);
                    return;
                }
                if (address === 0xff23) {
                    this.apu.writeChannel4Control(value);
                    return;
                }
                if (address === 0xff24) {
                    this.apu.writeMasterVolume(value);
                    return;
                }
                if (address === 0xff25) {
                    this.apu.writeAudioChannelPanning(value);
                    return;
                }
                else if (address === 0xff26) {
                    this.apu.writeAudioMasterControl(value);
                    return;
                }
                else if (address >= 0xff30 && address <= 0xff3f) {
                    this.apu.writeChannel3WavePattern(address - 0xff30, value);
                    return;
                }
                return;
            }
            if (address === 0xff40) {
                this.ppu.writeFF40(value);
                return;
            }
            if (address === 0xff41) {
                this.ppu.writeFF41(value);
                return;
            }
            if (address === 0xff42) {
                this.ppu.writeFF42(value);
                return;
            }
            if (address === 0xff43) {
                this.ppu.writeFF43(value);
                return;
            }
            if (address === 0xff44) {
                // Ignoring write to read only LY variable
                return;
            }
            if (address === 0xff45) {
                this.ppu.writeFF45(value);
                return;
            }
            if (address === 0xff46) {
                // Todo - we should actually check if there's a DMA in progress.
                this.writeFF46(value & 0xff);
                return;
            }
            if (address === 0xff47) {
                this.ppu.writeFF47(value);
                return;
            }
            if (address === 0xff48) {
                this.ppu.writeFF48(value);
                return;
            }
            if (address === 0xff49) {
                this.ppu.writeFF49(value);
                return;
            }
            if (address === 0xff4a) {
                this.ppu.writeFF4A(value);
                return;
            }
            if (address === 0xff4b) {
                this.ppu.writeFF4B(value);
                return;
            }
            else if (address === 0xff4f) {
                // we don't support vram bank selects, that's a GBC thing
                return;
            }
            if (address === 0xff7f) {
                // Tetris writes to this memory location, we just ignore it
                // https://www.reddit.com/r/EmuDev/comments/5nixai/gb_tetris_writing_to_unused_memory/
                return;
            }
            throw new Error("io write of value " + (0, utils_1.toHexString)(value) + " to address " + (0, utils_1.toHexString)(address) + " not implemented");
        }
        // High RAM (HRAM)
        if (address >= 0xff80 && address <= 0xfffe) {
            this.ram.writeHighRam(address - 0xff80, value);
            return;
        }
        // Interrupt Enable register (IE)
        if (address >= 0xffff && address <= 0xffff) {
            this.interrupts.setIE(value);
            return;
        }
        throw new Error("write outside of address space: " + (0, utils_1.toHexString)(address) + "");
    };
    BusImpl.prototype.enableDebugLog = function () {
        this.debugging = true;
    };
    BusImpl.prototype.disableDebugLog = function () {
        this.debugging = false;
    };
    return BusImpl;
}());
exports.BusImpl = BusImpl;


/***/ }),

/***/ "./src/gameboy/cart.ts":
/*!*****************************!*\
  !*** ./src/gameboy/cart.ts ***!
  \*****************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CartImpMBC5 = exports.CartImpMBC3 = exports.CartImpMBC2 = exports.CartImpMBC1 = exports.CartImplRomOnly = void 0;
exports.createCart = createCart;
function createCart(type, rom, cartridgeInfo) {
    switch (type) {
        case "ROM-ONLY":
            return new CartImplRomOnly(rom);
        case "MBC1":
        case "MBC1+RAM":
        case "MBC1+RAM+BATTERY":
            return new CartImpMBC1(rom, cartridgeInfo);
        case "MBC2":
        case "MBC2+BATTERY":
            return new CartImpMBC2(rom);
        case "MBC3":
        case "MBC3+RAM":
        case "MBC3+RAM+BATTERY":
        case "MBC3+TIMER+BATTERY":
        case "MBC3+TIMER+RAM+BATTERY":
            return new CartImpMBC3(rom);
        case "MBC5":
        case "MBC5+RAM":
        case "MBC5+RAM+BATTERY":
        case "MBC5+RUMBLE":
        case "MBC5+RUMBLE+RAM":
        case "MBC5+RUMBLE+RAM+BATTERY":
            return new CartImpMBC5(rom);
        case "UNKNOWN":
            throw new Error("cart type not supported");
    }
}
var CartImplRomOnly = /** @class */ (function () {
    function CartImplRomOnly(rom) {
        this.rom = rom;
    }
    CartImplRomOnly.prototype.read = function (address) {
        return this.rom[address];
    };
    CartImplRomOnly.prototype.write = function (address, value) {
        // Some games such as tetris seem to be buggy and write to this addr anyway (e.g. tetris writes to 0x2000)
        // so let's not throw an error.
        // https://www.reddit.com/r/EmuDev/comments/zddum6/gameboy_tetris_issues_with_getting_main_menu_to/
    };
    return CartImplRomOnly;
}());
exports.CartImplRomOnly = CartImplRomOnly;
var CartImpMBC1 = /** @class */ (function () {
    function CartImpMBC1(rom, cartridgeInfo) {
        this.rom = rom;
        this.cartridgeInfo = cartridgeInfo;
        this.selectedRomBank = 1;
        this.selectedRamBank = 0;
        this.mode = 0;
        this.ramEnabled = false;
        // Keep it simple, 4 possible ram banks
        this.ramBanks = [];
        this.lastPersisted = 0;
        var existingRam = localStorage.getItem(this.cartridgeInfo.title);
        if (existingRam) {
            this.ramBanks = JSON.parse(existingRam);
        }
    }
    CartImpMBC1.prototype.read = function (address) {
        if (address >= 0 && address <= 0x3fff) {
            return this.rom[address];
        }
        if (address >= 0x4000 && address <= 0x7fff) {
            // Switchable Rom Bank
            return this.rom[this.selectedRomBank * 0x4000 + (address - 0x4000)];
        }
        else if (address >= 0xa000 && address <= 0xbfff) {
            if (this.ramEnabled) {
                if (this.mode === 0) {
                    return this.ramBanks[address - 0xa000];
                }
                else {
                    return this.ramBanks[this.selectedRamBank * 0x2000 + (address - 0xa000)];
                }
            }
            else {
                return 0x00;
            }
        }
        else {
            throw Error("cart memory region not supported");
        }
    };
    CartImpMBC1.prototype.persistRam = function () {
        var now = performance.now();
        if (now - this.lastPersisted > 3000) {
            this.lastPersisted = now;
            localStorage.setItem(this.cartridgeInfo.title, JSON.stringify(this.ramBanks));
        }
    };
    CartImpMBC1.prototype.write = function (address, value) {
        // Ram writes
        if (address >= 0xa000 && address <= 0xbfff) {
            if (this.ramEnabled) {
                if (this.mode === 0) {
                    this.ramBanks[address - 0xa000] = value;
                }
                else {
                    this.ramBanks[this.selectedRamBank * 0x2000 + (address - 0xa000)] = value;
                }
                // this.persistRam();
                return;
            }
            else {
                // ignore ram write to disabled ram
                return;
            }
        }
        // MBC1 register writes:
        if (address >= 0x0 && address <= 0x1fff) {
            if ((value & 0xf) === 0xa) {
                this.ramEnabled = true;
            }
            else {
                this.ramEnabled = false;
            }
            return;
        }
        if (address >= 0x2000 && address <= 0x3fff) {
            //
            var romBank = (value & 31) | (this.selectedRomBank & 96);
            // Rom romBank 0 gets automatcially converted to 1 because you cant map 0 twice,
            // this also applies to banks 0x20, 0x40 and 0x60
            if (romBank == 0x00 || romBank == 0x20 || romBank == 0x40 || romBank == 0x60) {
                this.selectedRomBank = romBank + 1;
            }
            else {
                this.selectedRomBank = romBank;
            }
            return;
        }
        if (address >= 0x4000 && address <= 0x5fff) {
            if (this.mode === 0) {
                // rom banking mode
                var highBitsRomBank = value & 96;
                this.selectedRomBank = (this.selectedRomBank & 31) | (highBitsRomBank << 5);
            }
            else {
                // ram banking mode
                var ramBank = value & 0x3;
                this.selectedRamBank = ramBank;
            }
            return;
        }
        if (address >= 0x6000 && address <= 0x7fff) {
            this.mode = value & 0x1;
            return;
        }
    };
    return CartImpMBC1;
}());
exports.CartImpMBC1 = CartImpMBC1;
var CartImpMBC2 = /** @class */ (function () {
    function CartImpMBC2(rom) {
        this.rom = rom;
        this.selectedRomBank = 1;
        this.ramEnabled = false;
        this.ram = [];
    }
    CartImpMBC2.prototype.read = function (address) {
        // ROM Bank 0 - read only
        if (address >= 0x0 && address <= 0x3fff) {
            return this.rom[address];
        }
        // ROM Bank 1 - 16 - read only
        if (address >= 0x4000 && address <= 0x7fff) {
            return this.rom[this.selectedRomBank * 0x4000 + (address - 0x4000)];
        }
        // Built In Ram
        if (address >= 0xa000 && address <= 0xa1ff) {
            return this.ram[address - 0xa000];
        }
        // Echo 0xA000 - 0xA1FF, only lower 9 bits
        if (address >= 0xa200 && address <= 0xbfff) {
            var lower9Bits = address & 511;
            return this.ram[lower9Bits];
        }
        return 0;
    };
    CartImpMBC2.prototype.write = function (address, value) {
        // Ram enable + rom bank register
        if (address >= 0x0 && address <= 0x3fff) {
            // least significant bit of upper address byte controls ram/rom config
            // Shift out lower byte of address
            var bit8 = ((address & 0xffff) >> 8) & 0x1;
            if (!bit8) {
                // ram config
                if ((value & 0xff) === 0x0a) {
                    this.ramEnabled = true;
                }
                else {
                    this.ramEnabled = false;
                }
            }
            else {
                // rom config
                if ((value & 0xff) === 0) {
                    this.selectedRomBank = 1;
                }
                else {
                    this.selectedRomBank = value & 0xf;
                }
            }
        }
        // Built In Ram
        if (address >= 0xa000 && address <= 0xa1ff) {
            this.ram[address - 0xa000] = value & 0xff;
        }
        // Echo 0xA000 - 0xA1FF, only lower 9 bits
        if (address >= 0xa200 && address <= 0xbfff) {
            var lower9Bits = address & 511;
            this.ram[lower9Bits] = value & 0xff;
        }
    };
    return CartImpMBC2;
}());
exports.CartImpMBC2 = CartImpMBC2;
var CartImpMBC3 = /** @class */ (function () {
    function CartImpMBC3(rom, startTime) {
        if (startTime === void 0) { startTime = performance.now(); }
        this.rom = rom;
        this.startTime = startTime;
        this.selectedRomBank = 1;
        this.selectedRamBank = 1;
        this.ramBanks = [];
        this.ramAndRtcEnabled = false;
        // 0xa000-0xbfff can be mapped to either ram or RTC.
        // If this value is set then mapping is set to RTC.
        this.selectedRTCRegister = null;
        // We've got 5 rtc registers
        this.rtcRegisters = [0, 0, 0, 0, 0];
        // True when last write to latch was 0x00;
        this.latchWrote00 = false;
    }
    CartImpMBC3.prototype.read = function (address) {
        var _a;
        // ROM Bank 0 - read only
        if (address >= 0x0 && address <= 0x3fff) {
            return this.rom[address];
        }
        // ROM BANKS 1...
        if (address >= 0x4000 && address <= 0x7fff) {
            return this.rom[this.selectedRomBank * 0x4000 + (address - 0x4000)];
        }
        // Built In Ram or rtc
        if (address >= 0xa000 && address <= 0xbfff) {
            if (this.ramAndRtcEnabled) {
                if (this.selectedRTCRegister === null) {
                    if (this.ramBanks[this.selectedRamBank] === undefined) {
                        this.ramBanks[this.selectedRamBank] = [];
                    }
                    return (_a = this.ramBanks[this.selectedRamBank][address - 0xa000]) !== null && _a !== void 0 ? _a : 0x0;
                }
                else {
                    return this.rtcRegisters[this.selectedRTCRegister];
                }
            }
        }
        return 0;
    };
    CartImpMBC3.prototype.write = function (address, value) {
        if (address >= 0x0 && address <= 0x1fff) {
            if ((value & 0xff) === 0x0a) {
                this.ramAndRtcEnabled = true;
            }
            else {
                this.ramAndRtcEnabled = false;
            }
        }
        if (address >= 0xa000 && address <= 0xbfff) {
            if (this.ramAndRtcEnabled) {
                if (this.selectedRTCRegister === null) {
                    // Ram write
                    if (this.ramBanks[this.selectedRamBank] === undefined) {
                        this.ramBanks[this.selectedRamBank] = [];
                    }
                    this.ramBanks[this.selectedRamBank][address - 0xa000] = value & 0xff;
                }
                else {
                    this.rtcRegisters[this.selectedRTCRegister] = value & 0xff;
                }
            }
        }
        if (address >= 0x2000 && address <= 0x3fff) {
            // 7 bits rom bank
            if (value === 0) {
                this.selectedRomBank = 1;
            }
            else {
                this.selectedRomBank = value & 127;
            }
        }
        if (address >= 0x4000 && address <= 0x5fff) {
            if (value >= 0x0 && value <= 0x3) {
                this.selectedRamBank = value;
                this.selectedRTCRegister = null;
            }
            if (value >= 0x8 && value <= 0xc) {
                this.selectedRTCRegister = value - 0x8;
            }
        }
        if (address >= 0x6000 && address <= 0x7fff) {
            if (value === 0x0) {
                this.latchWrote00 = true;
            }
            else {
                if (value === 0x1) {
                    this.latchClockData();
                }
                this.latchWrote00 = false;
            }
        }
    };
    CartImpMBC3.prototype.latchClockData = function () {
        // We'll only fill seconds, minutes and hours and the lower bits for days for now
        var totalSeconds = (performance.now() - this.startTime) / 1000;
        var days = Math.floor(totalSeconds / (3600 * 24));
        var remainingSeconds = totalSeconds % (3600 * 24);
        var hours = Math.floor(remainingSeconds / 3600);
        var remainingMinutes = remainingSeconds % 3600;
        var minutes = Math.floor(remainingMinutes / 60);
        var seconds = Math.floor(remainingMinutes % 60);
        this.rtcRegisters[0] = seconds & 0xff;
        this.rtcRegisters[1] = minutes & 0xff;
        this.rtcRegisters[2] = hours & 0xff;
        this.rtcRegisters[3] = days & 0xff;
        this.rtcRegisters[4] = 0; // upper one bit of day counter + halt (6) + carry (7)
    };
    return CartImpMBC3;
}());
exports.CartImpMBC3 = CartImpMBC3;
var CartImpMBC5 = /** @class */ (function () {
    function CartImpMBC5(rom) {
        this.rom = rom;
        this.selectedRomBank = 1;
        this.selectedRamBank = 1;
        this.ramBanks = [];
        this.ramEnabled = false;
    }
    CartImpMBC5.prototype.read = function (address) {
        // ROM Bank 0 - read only
        if (address >= 0x0 && address <= 0x3fff) {
            return this.rom[address];
        }
        // ROM Bank 1 - 16 - read only
        if (address >= 0x4000 && address <= 0x7fff) {
            return this.rom[this.selectedRomBank * 0x4000 + (address - 0x4000)];
        }
        // Built In Ram
        if (address >= 0xa000 && address <= 0xbfff) {
            if (this.ramEnabled) {
                if (!this.ramBanks[this.selectedRamBank]) {
                    this.ramBanks[this.selectedRamBank] = [];
                }
                return this.ramBanks[this.selectedRamBank][address - 0xa000];
            }
        }
        return 0;
    };
    CartImpMBC5.prototype.write = function (address, value) {
        if (address >= 0x0 && address <= 0x1fff) {
            if (value === 0x0a) {
                this.ramEnabled = true;
            }
            else {
                // Todo (disable only for 0x0?)
                this.ramEnabled = false;
            }
        }
        if (address >= 0x2000 && address <= 0x2fff) {
            // 8 most significant bits for rom bank
            this.selectedRomBank = (this.selectedRomBank & 256) | (value & 0xff);
        }
        if (address >= 0x3000 && address <= 0x3fff) {
            // 9th bit of rom bank
            this.selectedRomBank = ((value & 0x1) << 9) | (this.selectedRomBank & 0xff);
        }
        if (address >= 0x4000 && address <= 0x5fff) {
            // ram bank number
            this.selectedRamBank = value & 0xf;
        }
        // Built In Ram
        if (address >= 0xa000 && address <= 0xbfff) {
            if (this.ramEnabled) {
                if (!this.ramBanks[this.selectedRamBank]) {
                    this.ramBanks[this.selectedRamBank] = [];
                }
                this.ramBanks[this.selectedRamBank][address - 0xa000] = value & 0xff;
            }
        }
    };
    return CartImpMBC5;
}());
exports.CartImpMBC5 = CartImpMBC5;


/***/ }),

/***/ "./src/gameboy/cbops.ts":
/*!******************************!*\
  !*** ./src/gameboy/cbops.ts ***!
  \******************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CBOps = void 0;
var CBOps = /** @class */ (function () {
    function CBOps() {
    }
    var _a;
    _a = CBOps;
    CBOps.rlc = function (getArg, setArg, cpu) {
        var value = getArg();
        var cFlag = (value & 0x80) > 0 ? 1 : 0;
        var result = ((value << 1) & 0xff) | cFlag;
        setArg(result);
        var zFlag = result === 0 ? 1 : 0;
        cpu.setFlagZ(zFlag);
        cpu.setFlagC(cFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        return 8;
    };
    CBOps.rrc = function (getArg, setArg, cpu) {
        var value = getArg();
        var result = ((value >> 1) & 0xff) | ((value << 7) & 0xff);
        setArg(result);
        var zFlag = result === 0 ? 1 : 0;
        var cFlag = value & 0x1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagC(cFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        return 8;
    };
    CBOps.rl = function (getArg, setArg, cpu) {
        // carry is part of the rotate operation
        var value = getArg();
        var result = ((value << 1) | cpu.getFlagC()) & 0xff;
        setArg(result);
        var zFlag = result === 0 ? 1 : 0;
        var cFlag = (value >> 7) & 0x1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagC(cFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        return 8;
    };
    CBOps.rr = function (getArg, setArg, cpu) {
        // carry is part of the rotate operation
        var value = getArg();
        var result = (value >> 1) | ((cpu.getFlagC() << 7) & 0xff);
        setArg(result);
        var zFlag = result === 0 ? 1 : 0;
        var cFlag = value & 0x1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagC(cFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        return 8;
    };
    CBOps.swap = function (getArg, setArg, cpu) {
        var value = getArg();
        var result = (((value & 0xf0) >> 4) | ((value & 0x0f) << 4)) & 0xff;
        setArg(result);
        cpu.setFlagN(0);
        cpu.setFlagC(0);
        cpu.setFlagH(0);
        var zFlag = result === 0 ? 1 : 0;
        cpu.setFlagZ(zFlag);
        return 8;
    };
    CBOps.sla = function (getArg, setArg, cpu) {
        var value = getArg();
        var result = (value << 1) & 0xff;
        setArg(result);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        var zFlag = result === 0 ? 1 : 0;
        cpu.setFlagZ(zFlag);
        var cFlag = (value & 0x80) === 0x80 ? 1 : 0;
        cpu.setFlagC(cFlag);
        return 8; // todo, cycle count is wrong for HL, probably in the other ones too
    };
    CBOps.sra = function (getArg, setArg, cpu) {
        var value = getArg();
        var result = ((value >> 1) | (value & 0x80)) & 0xff;
        setArg(result);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        var zFlag = result === 0 ? 1 : 0;
        cpu.setFlagZ(zFlag);
        var cFlag = value & 0x1;
        cpu.setFlagC(cFlag);
        return 8; // todo, cycle count is wrong for HL, probably in the other ones too
    };
    CBOps.srl = function (getArg, setArg, cpu) {
        var value = getArg();
        var cFlag = value & 0x1;
        var result = value >> 1;
        var zFlag = result === 0 ? 1 : 0;
        setArg(result);
        cpu.setFlagZ(zFlag);
        cpu.setFlagC(cFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(0);
        return 8;
    };
    CBOps.bit0 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 0;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit1 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 1;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit2 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 2;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit3 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 3;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit4 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 4;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit5 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 5;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit6 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 6;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.bit7 = function (getArg, setArg, cpu) {
        var value = getArg();
        var bitPos = 7;
        var zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
        cpu.setFlagZ(zFlag);
        cpu.setFlagN(0);
        cpu.setFlagH(1);
        return 8;
    };
    CBOps.res0 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 0) & 0xff));
        return 8;
    };
    CBOps.res1 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 1) & 0xff));
        return 8;
    };
    CBOps.res2 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 2) & 0xff));
        return 8;
    };
    CBOps.res3 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 3) & 0xff));
        return 8;
    };
    CBOps.res4 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 4) & 0xff));
        return 8;
    };
    CBOps.res5 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 5) & 0xff));
        return 8;
    };
    CBOps.res6 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 6) & 0xff));
        return 8;
    };
    CBOps.res7 = function (getArg, setArg) {
        var value = getArg();
        setArg(value & (~(0x1 << 7) & 0xff));
        return 8;
    };
    CBOps.set0 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 0) & 0xff));
        return 8;
    };
    CBOps.set1 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 1) & 0xff));
        return 8;
    };
    CBOps.set2 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 2) & 0xff));
        return 8;
    };
    CBOps.set3 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 3) & 0xff));
        return 8;
    };
    CBOps.set4 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 4) & 0xff));
        return 8;
    };
    CBOps.set5 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 5) & 0xff));
        return 8;
    };
    CBOps.set6 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 6) & 0xff));
        return 8;
    };
    CBOps.set7 = function (getArg, setArg) {
        var value = getArg();
        setArg(value | ((0x1 << 7) & 0xff));
        return 8;
    };
    CBOps.opsTable = [
        // No need for 16 columns since a single row has at most 2 different operation types
        [_a.rlc, _a.rrc], // 0x0
        [_a.rl, _a.rr], // 0x1
        [_a.sla, _a.sra], // 0x2
        [_a.swap, _a.srl], // 0x3
        [_a.bit0, _a.bit1], // 0x4
        [_a.bit2, _a.bit3], // 0x5
        [_a.bit4, _a.bit5], // 0x6
        [_a.bit6, _a.bit7], // 0x7
        [_a.res0, _a.res1], // 0x8
        [_a.res2, _a.res3], // 0x9
        [_a.res4, _a.res5], // 0xA
        [_a.res6, _a.res7], // 0xB
        [_a.set0, _a.set1], // 0xC
        [_a.set2, _a.set3], // 0xD
        [_a.set4, _a.set5], // 0xE
        [_a.set6, _a.set7], // 0xF
    ];
    return CBOps;
}());
exports.CBOps = CBOps;


/***/ }),

/***/ "./src/gameboy/cpu.ts":
/*!****************************!*\
  !*** ./src/gameboy/cpu.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CPU = void 0;
var cbops_1 = __webpack_require__(/*! ./cbops */ "./src/gameboy/cbops.ts");
var utils_1 = __webpack_require__(/*! ./utils */ "./src/gameboy/utils.ts");
/**
 * Simple CPU implementation. Initially, I just wrote command by command without using any major abstractions
 * because I wanted to be able to see the full inner workings of a cpu command within one function.
 * However, this became a bit tedious over time so that I used some abstraction on some of the commands,
 * especially the cb ops, which would have otherwise needed a tremendeous amount of code.
 */
var CPU = /** @class */ (function () {
    function CPU(bus, interrupts, ppu, apu, serial, dma, timer) {
        var _this = this;
        this.bus = bus;
        this.interrupts = interrupts;
        this.ppu = ppu;
        this.apu = apu;
        this.serial = serial;
        this.dma = dma;
        this.timer = timer;
        /**
           * Init state after boot rom: https://robertheaton.com/gameboy-doctor/
              Register	Value
              A	0x01
              F	0xB0 (or CH-Z if managing flags individually)
              B	0x00
              C	0x13
              D	0x00
              E	0xD8
              H	0x01
              L	0x4D
              SP	0xFFFE
              PC	0x0100
           */
        // We'll keep all in 16 bit regiters
        // and provide accessor methods below.
        // Keep in mind that gameboy uses little endian!
        // For accessing the registers, always use the getters and setters
        // to convert the endianess.
        this.registers = {
            AF: 45057, // e.g. flags (F) = 0xb0 due to endiness
            BC: 4864,
            DE: 55296,
            HL: 19713,
            SP: 65279, // 0xFF_FE stack pointer
            PC: 1, // 0x01_00 = start address
        };
        // For us internally
        this.instructionCount = 0;
        // Set to true once we enable debug mode
        this.debugging = false;
        // Used this while debugging to see what instructions were used as part of the program execution.
        // These will be printed as soon as you enter debugging mode.
        this.usedInstructions = new Set();
        this.totalExecutedInstructionCount = 0;
        this.maxLastOperations = 30;
        // For debugging purposes, last x operations
        this.lastXOperations = [];
        // We manually killed the cpu, e.g. in case we want to load a new rom.
        // Once killed, there's no way back.
        this.killed = false;
        // Triggered by normal halt instruction
        this.halted = false;
        // IME, enable interrupts next cycle
        this.enableInterruptsOnNextCycle = false;
        // just to keep track of the cycles per frame
        this.cyclesThisFrame = 0;
        // Always resets after 4 to translate tcycles to mcycles
        this.tickModulo = 0;
        // Modulo to clock the serial connection
        this.serialTickModulo = 0;
        this.cyclesPerSec = 4194304;
        this.cyclesPerFrame = this.cyclesPerSec / 59;
        this.timePerFrameMs = 1000 / 60;
        this.startTimeMs = performance.now();
        // Implementations of our cpu instructions
        // 0x00
        this.nop = function () {
            _this.increasePC();
            _this.tick(4);
        };
        // 0x01: LD BC,d16
        this.loadImmediate16ToBC = function () {
            _this.increasePC();
            _this.tick(4);
            // get value
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            var value = (msb << 8) + lsb;
            _this.setRegisterBC(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x02 LD (BC), A, writes A into address in BC
        this.ldBCAddrA = function () {
            _this.increasePC();
            var address = _this.getRegisterBC();
            var value = _this.getRegisterA();
            _this.bus.write(address, value);
            _this.tick(8); // accuracy not super important here
        };
        // 0x03 INC BC
        this.incBC = function () {
            _this.increasePC();
            _this.setRegisterBC((_this.getRegisterBC() + 1) & 0xffff);
            _this.tick(8);
        };
        // 0x04: INC B
        this.incB = function () {
            _this.increasePC();
            var value = _this.getRegisterB();
            var result = (value + 1) & 0xff;
            _this.setRegisterB(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x05 DEC B
        // Visible for testing
        this.decB = function () {
            _this.increasePC();
            var r = _this.getRegisterB();
            var result = (r - 1) & 0xff;
            _this.setRegisterB(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x06: LD B,d8
        this.loadImmediate8ToB = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.setRegisterB(value);
            _this.tick(4);
        };
        // 0x07: RLCA, rotate
        this.rlca = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var cFlag = (a >> 7) & 0x1;
            var result = ((a << 1) & 0xff) | cFlag;
            _this.setRegisterA(result);
            _this.setFlagC(cFlag);
            _this.setFlagZ(0);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.tick(4);
        };
        // 0x08: LD (a16),SP
        this.lda16SP = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var addressMsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (addressMsb << 8) + addressLsb;
            var sp = _this.getSP();
            var spLsb = sp & 0xff;
            var spMsb = (sp >> 8) & 0xff;
            _this.bus.write(address, spLsb);
            _this.bus.write(address + 1, spMsb);
            _this.tick(8);
        };
        // 0x09: ADD HL,BC
        this.addHLBC = function () {
            _this.addHL(_this.getRegisterBC());
        };
        // 0x0A: LD A, (BC)
        this.ldABCAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterBC();
            var value = _this.bus.read(address);
            _this.setRegisterA(value);
            _this.tick(4);
        };
        // 0x0B: DEC BC
        this.decBC = function () {
            _this.increasePC();
            var value = _this.getRegisterBC();
            _this.setRegisterBC((value - 1) & 0xffff);
            _this.tick(8);
        };
        // 0x0C: INC C
        this.incC = function () {
            _this.increasePC();
            var value = _this.getRegisterC();
            var result = (value + 1) & 0xff;
            _this.setRegisterC(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x0D DEC C
        this.decC = function () {
            _this.increasePC();
            var result = (_this.getRegisterC() - 1) & 0xff;
            _this.setRegisterC(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x0E: LD C,d8
        this.loadImmediate8ToC = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.setRegisterC(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x0F: RRCA, rotate
        this.rrca = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var cFlag = a & 0x1;
            var result = ((a >> 1) & 0xff) | (cFlag << 7);
            _this.setRegisterA(result);
            _this.setFlagC(cFlag);
            _this.setFlagZ(0);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.tick(4);
        };
        // 0x11: LD DE,d16
        this.loadImmediate16ToDE = function () {
            _this.increasePC();
            _this.tick(4);
            // get value
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            var value = (msb << 8) + lsb;
            _this.setRegisterDE(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x12 LD (DE), A, writes A into address in DE
        this.ldDEAddrA = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterDE();
            var value = _this.getRegisterA();
            _this.bus.write(address, value);
            _this.tick(4);
        };
        // 0x13 INC DE
        this.incDE = function () {
            _this.increasePC();
            _this.setRegisterDE((_this.getRegisterDE() + 1) & 0xffff);
            _this.tick(8);
        };
        // 0x14: INC D
        this.incD = function () {
            _this.increasePC();
            var value = _this.getRegisterD();
            var result = (value + 1) & 0xff;
            _this.setRegisterD(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x15 DEC D
        this.decD = function () {
            _this.increasePC();
            var result = (_this.getRegisterD() - 1) & 0xff;
            _this.setRegisterD(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x16: LD D,d8
        this.loadImmediate8ToD = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.setRegisterD(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x17: RLA
        this.rla = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var cFlag = _this.getFlagC();
            var newCFlag = a >> 7 === 0x1 ? 1 : 0;
            var result = (a << 1) | cFlag;
            _this.setRegisterA(result);
            _this.setFlagC(newCFlag);
            _this.setFlagH(0);
            _this.setFlagN(0);
            _this.setFlagZ(0);
            _this.tick(4);
        };
        // 0x18: JR r8
        this.jrR8 = function () {
            _this.increasePC();
            _this.tick(4);
            var relativeAddressUnsigned = _this.bus.read(_this.getPC());
            _this.increasePC(); // not really needed but lets keep it in for completeness reasons
            _this.tick(4);
            var relativeAddressSigned = (0, utils_1.signedFrom8Bits)(relativeAddressUnsigned);
            _this.setPC(_this.getPC() + relativeAddressSigned);
            _this.tick(4);
        };
        // 0x19: ADD HL,DE
        this.addHLDE = function () {
            _this.addHL(_this.getRegisterDE());
        };
        // 0x1A: LD A, (DE)
        this.ldADEAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterDE();
            var value = _this.bus.read(address);
            _this.setRegisterA(value);
            _this.tick(4);
        };
        // 0x1B: DEC DE
        this.decDE = function () {
            _this.increasePC();
            var value = _this.getRegisterDE();
            _this.setRegisterDE((value - 1) & 0xffff);
            _this.tick(8);
        };
        // 0x1C INC E
        this.incE = function () {
            _this.increasePC();
            var value = _this.getRegisterE();
            var result = (value + 1) & 0xff;
            _this.setRegisterE(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x1D DEC E
        this.decE = function () {
            _this.increasePC();
            var result = (_this.getRegisterE() - 1) & 0xff;
            _this.setRegisterE(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x1E: LD E,d8
        this.loadImmediate8ToE = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.setRegisterE(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x1F: RRA
        this.rra = function () {
            var a = _this.getRegisterA();
            _this.increasePC();
            var result = (a >> 1) | (_this.getFlagC() << 7);
            _this.setRegisterA(result);
            _this.setFlagZ(0);
            _this.setFlagH(0);
            _this.setFlagN(0);
            _this.setFlagC(a & 0x1);
            _this.tick(4);
        };
        // 0x20 JR NZ,r8 => conditional jump tp relative address specified in r
        this.jrNzR8 = function () {
            _this.increasePC();
            _this.tick(4);
            var relativeAddressUnsigned = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var relativeAddressSigned = (0, utils_1.signedFrom8Bits)(relativeAddressUnsigned);
            if (_this.getFlagZ() === 0) {
                _this.setPC((_this.getPC() + relativeAddressSigned) & 0xffff);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0x21: LD HL,d16
        this.loadImmediate16ToHL = function () {
            _this.increasePC();
            _this.tick(4);
            // get value
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var value = (msb << 8) + lsb;
            _this.setRegisterHL(value);
        };
        // 0x22: LD (HL+),A => load from accumulator (indirect HL increment)
        this.loadFromAccumulatorIndirecHLIncrement = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterHL();
            var data = _this.getRegisterA();
            _this.bus.write(address, data);
            // HL has to be incremented as part of this operation
            _this.setRegisterHL(address + 1);
            _this.tick(4);
        };
        // 0x23 INC HL
        this.incHL = function () {
            _this.increasePC();
            _this.setRegisterHL((_this.getRegisterHL() + 1) & 0xffff);
            _this.tick(8);
        };
        // 0x24: INC H
        this.incH = function () {
            _this.increasePC();
            var value = _this.getRegisterH();
            var result = (value + 1) & 0xff;
            _this.setRegisterH(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x25 DEC H
        this.decH = function () {
            _this.increasePC();
            var result = (_this.getRegisterH() - 1) & 0xff;
            _this.setRegisterH(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x26: LD H,d8
        this.loadImmediate8ToH = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.setRegisterH(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x27: DAA, see https://ehaskins.com/2018-01-30%20Z80%20DAA/
        // for a great explanation of how the DAA instructions works
        this.daa = function () {
            _this.increasePC();
            var u = 0;
            var cFlag = 0;
            if (_this.getFlagH() === 1 || (_this.getFlagN() === 0 && (_this.getRegisterA() & 0xf) > 9)) {
                u = 6;
            }
            if (_this.getFlagC() === 1 || (_this.getFlagN() === 0 && _this.getRegisterA() > 0x99)) {
                u |= 0x60;
                cFlag = 1;
            }
            var result = _this.getFlagN() === 0 ? (_this.getRegisterA() + u) & 0xff : (_this.getRegisterA() - u) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagH(0);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // 0x28: JR Z, r8
        this.jrZr8 = function () {
            _this.increasePC();
            _this.tick(4);
            var relativeAddressUnsigned = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var relativeAddressSigned = (0, utils_1.signedFrom8Bits)(relativeAddressUnsigned);
            if (_this.getFlagZ() === 1) {
                _this.setPC((_this.getPC() + relativeAddressSigned) & 0xffff);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0x29: ADD HL,DE
        this.addHLHL = function () {
            _this.addHL(_this.getRegisterHL());
        };
        // 0x2A: LD A,(HL+), load address in HL to A and increment HL
        this.ldAHLPlus = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterHL();
            var value = _this.bus.read(address);
            _this.setRegisterA(value);
            _this.setRegisterHL((address + 1) & 0xffff);
            _this.tick(4);
        };
        // 0x2B: DEC HL
        this.decHL = function () {
            _this.increasePC();
            var value = _this.getRegisterHL();
            _this.setRegisterHL((value - 1) & 0xffff);
            _this.tick(8);
        };
        // 0x2C INC L
        this.incL = function () {
            _this.increasePC();
            var value = _this.getRegisterL();
            var result = (value + 1) & 0xff;
            _this.setRegisterL(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x2D: DEC L
        this.decL = function () {
            _this.increasePC();
            var result = (_this.getRegisterL() - 1) & 0xff;
            _this.setRegisterL(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x2E: LD L,d8
        this.loadImmediate8ToL = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.setRegisterL(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x2F: CPL, flip all bits in register A
        this.cpl = function () {
            _this.increasePC();
            var value = _this.getRegisterA();
            var result = value ^ 0xff;
            _this.setRegisterA(result);
            _this.setFlagN(1);
            _this.setFlagH(1);
            _this.tick(4);
        };
        // 0x30 JR NC,r8 => conditional jump tp relative address specified in r
        this.jrNCR8 = function () {
            _this.increasePC();
            _this.tick(4);
            var relativeAddressUnsigned = _this.bus.read(_this.getPC());
            var relativeAddressSigned = (0, utils_1.signedFrom8Bits)(relativeAddressUnsigned);
            _this.increasePC();
            _this.tick(4);
            if (_this.getFlagC() === 0) {
                _this.setPC(_this.getPC() + relativeAddressSigned);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0x31: LD SP,d16
        this.loadImmediate16ToSP = function () {
            _this.increasePC();
            _this.tick(4);
            // get value
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            var value = (msb << 8) + lsb;
            _this.setRegisterSP(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x32: LD (HL-),A => load from accumulator (indirect HL decrement)
        this.loadFromAccumulatorIndirecHLDecrement = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            var data = _this.getRegisterA();
            _this.bus.write(address, data);
            // HL has to be decremented as part of this operation
            _this.setRegisterHL((address - 1) & 0xffff);
            _this.tick(8);
        };
        // 0x33 INC SP
        this.incSP = function () {
            _this.increasePC();
            _this.setRegisterSP((_this.getRegisterSP() + 1) & 0xffff);
            _this.tick(8);
        };
        // 0x34 INC (HL)
        this.incHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterHL();
            var value = _this.bus.read(address);
            var result = (value + 1) & 0xff;
            _this.bus.write(address, result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(8);
        };
        // 0x35 DEC (HL)
        this.decHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getRegisterHL());
            var result = (value - 1) & 0xff;
            _this.bus.write(_this.getRegisterHL(), result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(8);
        };
        // 0x36: LD (HL),d8
        this.loadImmediateToAddressInHL = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterHL();
            var value = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.bus.write(address, value);
            _this.tick(8);
        };
        // 0x37: SCF - set carry flag
        this.scf = function () {
            _this.increasePC();
            _this.setFlagC(1);
            _this.setFlagH(0);
            _this.setFlagN(0);
            _this.tick(4);
        };
        // 0x38: JR C, r8
        this.jrCr8 = function () {
            _this.increasePC();
            _this.tick(4);
            var relativeAddressUnsigned = _this.bus.read(_this.getPC());
            var relativeAddressSigned = (0, utils_1.signedFrom8Bits)(relativeAddressUnsigned);
            _this.increasePC();
            _this.tick(4);
            if (_this.getFlagC() === 1) {
                _this.setPC(_this.getPC() + relativeAddressSigned);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0x39: ADD HL,SP
        this.addHLSP = function () {
            _this.increasePC();
            var hl = _this.getRegisterHL();
            var value = _this.getRegisterSP();
            var result = (hl + value) & 0xffff;
            _this.setRegisterHL(result);
            var hFlag = (hl & 0xfff) + (value & 0xfff) > 0xfff ? 1 : 0;
            var cFlag = hl + value > 0xffff ? 1 : 0;
            _this.setFlagN(0);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(8);
        };
        // 0x3A: LD A,(HL-), load address in HL to A and decrement HL
        this.ldAHLMinus = function () {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterHL();
            var value = _this.bus.read(address);
            _this.setRegisterA(value);
            _this.setRegisterHL((address - 1) & 0xffff);
            _this.tick(4);
        };
        // 0x3B: DEC SP
        this.decSP = function () {
            _this.increasePC();
            var value = _this.getRegisterSP();
            _this.setRegisterSP((value - 1) & 0xffff);
            _this.tick(8);
        };
        // 0x3C INC A
        this.incA = function () {
            _this.increasePC();
            var value = _this.getRegisterA();
            var result = (value + 1) & 0xff;
            _this.setRegisterA(result);
            // Update flags
            _this.setFlagN(0);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            var hFlag = (result & 0xf) === 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x3D: DEC A
        this.decA = function () {
            _this.increasePC();
            var result = (_this.getRegisterA() - 1) & 0xff;
            _this.setRegisterA(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(1);
            // Set H flag if we've gone from 0x10 to 0x0F
            var hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x3E: LD A,d8
        this.loadImmediate8ToA = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.setRegisterA(value);
            _this.increasePC();
            _this.tick(4);
        };
        // 0x3F: CCF - complement carry flag
        this.ccf = function () {
            _this.increasePC();
            var cFlag = _this.getFlagC() === 1 ? 0 : 1;
            _this.setFlagC(cFlag);
            _this.setFlagH(0);
            _this.setFlagN(0);
            _this.tick(4);
        };
        // 0x40: LD B,B
        this.ldBB = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterB()); // not really needed but lets leave it for completeness
            _this.tick(4);
        };
        // 0x41: LD B,C
        this.ldBC = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x42: LD B,D
        this.ldBD = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x43: LD B,E
        this.ldBE = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x44: LD B,H
        this.ldBH = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x45: LD B,L
        this.ldBL = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x46: LD CB, (HL)
        this.ldBHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterB(value); });
        };
        // 0x47: LD B,A
        this.ldBA = function () {
            _this.increasePC();
            _this.setRegisterB(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x48: LD C,B
        this.ldCB = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterB());
            _this.tick(4);
        };
        // 0x49: LD C,C
        this.ldCC = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x4A: LD C,D
        this.ldCD = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x4B: LD C,E
        this.ldCE = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x4C: LD C,H
        this.ldCH = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x4D: LD C,L
        this.ldCL = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x4E: LD C, (HL)
        this.ldCHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterC(value); });
        };
        // 0x4F: LD C,A
        this.ldCA = function () {
            _this.increasePC();
            _this.setRegisterC(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x50: LD D,B
        this.ldDB = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterB()); // not really needed but lets leave it for completeness
            _this.tick(4);
        };
        // 0x51: LD D,C
        this.ldDC = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x52: LD D,D
        this.ldDD = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x53: LD D,E
        this.ldDE = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x54: LD D,H
        this.ldDH = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x55: LD D,L
        this.ldDL = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x56: LD C, (HL)
        this.ldDHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterD(value); });
        };
        // 0x57: LD D,A
        this.ldDA = function () {
            _this.increasePC();
            _this.setRegisterD(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x58: LD E,B
        this.ldEB = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterB());
            _this.tick(4);
        };
        // 0x59: LD E,C
        this.ldEC = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x5A: LD E,D
        this.ldED = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x5B: LD E,E
        this.ldEE = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x5C: LD E,H
        this.ldEH = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x5D: LD E,L
        this.ldEL = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x5E: LD E, (HL)
        this.ldEHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterE(value); });
        };
        // 0x5F: LD E,A
        this.ldEA = function () {
            _this.increasePC();
            _this.setRegisterE(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x60: LD H,B
        this.ldHB = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterB()); // not really needed but lets leave it for completeness
            _this.tick(4);
        };
        // 0x61: LD H,C
        this.ldHC = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x62: LD H,D
        this.ldHD = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x63: LD H,E
        this.ldHE = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x64: LD H,H
        this.ldHH = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x65: LD H,L
        this.ldHL = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x66: LD CB, (HL)
        this.ldHHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterH(value); });
        };
        // 0x67: LD H,A
        this.ldHA = function () {
            _this.increasePC();
            _this.setRegisterH(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x68: LD L,B
        this.ldLB = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterB());
            _this.tick(4);
        };
        // 0x69: LD L,C
        this.ldLC = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x6A: LD L,D
        this.ldLD = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x6B: LD L,E
        this.ldLE = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x6C: LD L,H
        this.ldLH = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x6D: LD L,L
        this.ldLL = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x6E: LD L, (HL)
        this.ldLHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterL(value); });
        };
        // 0x6F: LD L,A
        this.ldLA = function () {
            _this.increasePC();
            _this.setRegisterL(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x70: LD (HL), B
        this.ldHLAddrB = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterB());
            _this.tick(8);
        };
        // 0x71: LD (HL), C
        this.ldHLAddrC = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterC());
            _this.tick(8);
        };
        // 0x72: LD (HL), D
        this.ldHLAddrD = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterD());
            _this.tick(8);
        };
        // 0x73: LD (HL), E
        this.ldHLAddrE = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterE());
            _this.tick(8);
        };
        // 0x74: LD (HL), H
        this.ldHLAddrH = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterH());
            _this.tick(8);
        };
        // 0x75: LD (HL), L
        this.ldHLAddrL = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterL());
            _this.tick(8);
        };
        // 0x76: halt
        this.halt = function () {
            _this.increasePC();
            _this.tick(4);
            _this.halted = true;
        };
        // 0x77: LD (HL), A
        this.ldHLAddrA = function () {
            _this.increasePC();
            var address = _this.getRegisterHL();
            _this.bus.write(address, _this.getRegisterA());
            _this.tick(8);
        };
        // 0x78: LD A,B
        this.ldAB = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterB());
            _this.tick(4);
        };
        // 0x79: LD A,C
        this.ldAC = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterC());
            _this.tick(4);
        };
        // 0x7A: LD A,D
        this.ldAD = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterD());
            _this.tick(4);
        };
        // 0x7B: LD A,E
        this.ldAE = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterE());
            _this.tick(4);
        };
        // 0x7C: LD A,H
        this.ldAH = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterH());
            _this.tick(4);
        };
        // 0x7D: LD A,L
        this.ldAL = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterL());
            _this.tick(4);
        };
        // 0x7E: LD A, (HL)
        this.ldAHLAddr = function () {
            _this.ldRHL(function (value) { return _this.setRegisterA(value); });
        };
        // 0x7F: LD A,A
        this.ldAA = function () {
            _this.increasePC();
            _this.setRegisterA(_this.getRegisterA());
            _this.tick(4);
        };
        // 0x80: ADD A,B
        this.addAB = function () {
            _this.add(_this.getRegisterB());
        };
        // 0x81: ADD A,C
        this.addAC = function () {
            _this.add(_this.getRegisterC());
        };
        // 0x82: ADD A,D
        this.addAD = function () {
            _this.add(_this.getRegisterD());
        };
        // 0x83: ADD A,E
        this.addAE = function () {
            _this.add(_this.getRegisterE());
        };
        // 0x84: ADD A,H
        this.addAH = function () {
            _this.add(_this.getRegisterH());
        };
        // 0x85: ADD A,L
        this.addAL = function () {
            _this.add(_this.getRegisterL());
        };
        // 0x86: ADD A,(HL)
        this.addAHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var v = _this.bus.read(_this.getRegisterHL());
            var result = (a + v) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var hFlag = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
            var cFlag = a + v > 0xff ? 1 : 0;
            _this.setFlagN(0);
            _this.setFlagZ(zFlag);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // 0x87: ADD A,A
        this.addAA = function () {
            _this.add(_this.getRegisterA());
        };
        // 0x88: ADC A,B
        this.addcAB = function () {
            _this.increasePC();
            var value = _this.getRegisterB();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x89: ADC A,C
        this.addcAC = function () {
            _this.increasePC();
            var value = _this.getRegisterC();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x8A: ADC A,D
        this.addcAD = function () {
            _this.increasePC();
            var value = _this.getRegisterD();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x8B: ADC A,E
        this.addcAE = function () {
            _this.increasePC();
            var value = _this.getRegisterE();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x8C: ADC A,H
        this.addcAH = function () {
            _this.increasePC();
            var value = _this.getRegisterH();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x8D: ADC A,L
        this.addcAL = function () {
            _this.increasePC();
            var value = _this.getRegisterL();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x8E: ADC A,(HL)
        this.addcAHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getRegisterHL());
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x8F: ADC A,A
        this.addcAA = function () {
            _this.increasePC();
            var value = _this.getRegisterA();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x90: SUB B
        this.subB = function () {
            _this.sub(_this.getRegisterB());
        };
        // 0x91: SUB C
        this.subC = function () {
            _this.sub(_this.getRegisterC());
        };
        // 0x92: SUB D
        this.subD = function () {
            _this.sub(_this.getRegisterD());
        };
        // 0x93: SUB E
        this.subE = function () {
            _this.sub(_this.getRegisterE());
        };
        // 0x94: SUB H
        this.subH = function () {
            _this.sub(_this.getRegisterH());
        };
        // 0x95: SUB L
        this.subL = function () {
            _this.sub(_this.getRegisterL());
        };
        // 0x96: SUB HL
        this.subHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var v = _this.bus.read(_this.getRegisterHL());
            var result = (a - v) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 1;
            var cFlag = a - v < 0 ? 1 : 0;
            var hFlag = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0x97: SUB A
        this.subA = function () {
            _this.sub(_this.getRegisterA());
        };
        // 0x98 SBC A,B
        this.sbcAB = function () {
            _this.sbc(_this.getRegisterB());
        };
        // 0x99 SBC A,C
        this.sbcAC = function () {
            _this.sbc(_this.getRegisterC());
        };
        // 0x9A SBC A,D
        this.sbcAD = function () {
            _this.sbc(_this.getRegisterD());
        };
        // 0x9B SBC A,E
        this.sbcAE = function () {
            _this.sbc(_this.getRegisterE());
        };
        // 0x9C SBC A,H
        this.sbcAH = function () {
            _this.sbc(_this.getRegisterH());
        };
        // 0x9D SBC A,L
        this.sbcAL = function () {
            _this.sbc(_this.getRegisterL());
        };
        // 0x9E SBC A,(HL)
        this.sbcAHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var n = _this.bus.read(_this.getRegisterHL());
            var carry = _this.getFlagC();
            var result = (a - n - carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 1;
            var hFlag = (a & 0xf) - (n & 0xf) - carry < 0 ? 1 : 0;
            var cFlag = (a & 0xff) - (n & 0xff) - carry < 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // 0x9F SBC A,A
        this.sbcAA = function () {
            _this.sbc(_this.getRegisterA());
        };
        // 0xA0: AND B
        this.andB = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterB();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA1: AND C
        this.andC = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterC();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA2: AND D
        this.andD = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterD();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA3: AND E
        this.andE = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterE();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA4: AND H
        this.andH = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterH();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA5: AND L
        this.andL = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterL();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA6: AND (HL)
        this.andHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var r = _this.bus.read(_this.getRegisterHL());
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA7: AND A
        this.andA = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterA();
            var result = a & r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlagValue = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlagValue);
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xA8: XOR B
        this.xorRegisterB = function () {
            var a = _this.getRegisterA();
            var r = _this.getRegisterB();
            var result = a ^ r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xA9: XOR C
        this.xorRegisterC = function () {
            var a = _this.getRegisterA();
            var r = _this.getRegisterC();
            var result = (a ^ r) & 0xff;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xAA: XOR D
        this.xorRegisterD = function () {
            var a = _this.getRegisterA();
            var r = _this.getRegisterD();
            var result = (a ^ r) & 0xff;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xAB: XOR E
        this.xorRegisterE = function () {
            var a = _this.getRegisterA();
            var r = _this.getRegisterE();
            var result = a ^ r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xAC: XOR H
        this.xorRegisterH = function () {
            var a = _this.getRegisterA();
            var r = _this.getRegisterH();
            var result = a ^ r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xAD: XOR L
        this.xorRegisterL = function () {
            var a = _this.getRegisterA();
            var r = _this.getRegisterL();
            var result = a ^ r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xAE: XOR (HL)
        this.xorHLAddr = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            _this.tick(4);
            var r = _this.bus.read(_this.getRegisterHL());
            var result = a ^ r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.tick(4);
        };
        // 0xAF: XOR A
        this.xorRegisterA = function () {
            var a = _this.getRegisterA();
            var result = (a ^ a) & 0xff;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.increasePC();
            _this.tick(4);
        };
        // 0xB0: OR B
        this.orB = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterB();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB1: OR C
        this.orC = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterC();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB2: OR D
        this.orD = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterD();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB3: OR E
        this.orE = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterE();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB4: OR H
        this.orH = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterH();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB5: OR L
        this.orL = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterL();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB6: OR (HL)
        this.orHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var r = _this.bus.read(_this.getRegisterHL());
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB7: OR A
        this.orA = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterA();
            var result = a | r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagH(0);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xB8: CP B (Compare B)
        this.cpB = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterB();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xB9: CP C (Compare C)
        this.cpC = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterC();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xBA: CP D (Compare D)
        this.cpD = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterD();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xBB: CP E (Compare E)
        this.cpE = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterE();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xBC: CP H (Compare H)
        this.cpH = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterH();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xBD: CP L (Compare L)
        this.cpL = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterL();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xBE: CP (HL) (Compare (HL))
        this.cpHLAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var r = _this.bus.read(_this.getRegisterHL());
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xBF: CP A (Compare A)
        this.cpA = function () {
            _this.increasePC();
            var a = _this.getRegisterA();
            var r = _this.getRegisterA();
            var zFlag = a - r === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            var cFlag = a - r < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            var hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xC0: RET NZ
        this.retNZ = function () {
            _this.increasePC();
            _this.tick(8);
            if (_this.getFlagZ() === 0) {
                var addressLsb = _this.bus.read(_this.getSP());
                _this.increaseSP();
                var addressMsb = _this.bus.read(_this.getSP());
                _this.increaseSP();
                var address = (addressMsb << 8) + addressLsb;
                _this.setPC(address);
                _this.tick(12);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xC1: POP BC
        this.popBC = function () {
            _this.increasePC();
            _this.tick(4);
            var dataLsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var dataMsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var data = (dataMsb << 8) + dataLsb;
            _this.setRegisterBC(data);
        };
        // 0xC2: JP NZ,a16
        this.jpNZa16 = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var addressMsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (addressMsb << 8) + addressLsb;
            if (_this.getFlagZ() === 0) {
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xC3: JP a16, unconditional jump to 16bit address
        this.jpUnconditional = function () {
            var pc = _this.getPC();
            _this.increasePC();
            _this.tick(4);
            // get address
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (msb << 8) + lsb;
            _this.setPC(address);
            _this.tick(4);
        };
        // 0xC4: CALL NZ, a16
        this.callNZa16 = function () {
            _this.increasePC();
            _this.tick(4);
            // get address
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (msb << 8) + lsb;
            if (_this.getFlagZ() === 0) {
                // back up current address and jump to location
                var currentPC = _this.getPC();
                var pcLsb = currentPC & 0xff;
                var pcMsb = (currentPC >> 8) & 0xff;
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcMsb);
                _this.tick(4);
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcLsb);
                _this.tick(4);
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            return false;
        };
        // 0xC5: PUSH BC
        this.pushBC = function () {
            _this.push16(_this.getRegisterBC());
        };
        // 0xC6 ADD A,d8
        this.addAd8 = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var v = _this.bus.read(_this.getPC());
            _this.increasePC();
            var result = (a + v) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var hFlag = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
            var cFlag = a + v > 0xff ? 1 : 0;
            _this.setFlagN(0);
            _this.setFlagZ(zFlag);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // 0xC7 RST 00H - restart to absolute fixed address
        this.rst00H = function () {
            _this.increasePC();
            _this.tick(4);
            var address = 0x00;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.tick(4);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.tick(4);
            _this.setPC(address);
            _this.tick(4);
        };
        // 0xC8: RETZ, conditional return
        this.retZ = function () {
            _this.increasePC();
            _this.tick(8);
            if (_this.getFlagZ() === 1) {
                var addressLsb = _this.bus.read(_this.getSP());
                _this.tick(4);
                _this.increaseSP();
                var addressMsb = _this.bus.read(_this.getSP());
                _this.tick(4);
                _this.increaseSP();
                var address = (addressMsb << 8) + addressLsb;
                _this.tick(4);
                _this.setPC(address);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xC9: RET, unconditional return
        this.ret = function () {
            _this.increasePC(); // not really needed but added for completeness
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getSP());
            _this.tick(4);
            _this.increaseSP();
            var addressMsb = _this.bus.read(_this.getSP());
            _this.tick(4);
            _this.increaseSP();
            var address = (addressMsb << 8) + addressLsb;
            _this.setPC(address);
            _this.tick(4);
        };
        // 0xCA: JP Z, a16
        this.jpZa16 = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var addressMsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (addressMsb << 8) + addressLsb;
            if (_this.getFlagZ() === 1) {
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xCB - Prefix ops
        this.cb = function () {
            var operands = [
                [function () { return _this.getRegisterB(); }, function (value) { return _this.setRegisterB(value); }],
                [function () { return _this.getRegisterC(); }, function (value) { return _this.setRegisterC(value); }],
                [function () { return _this.getRegisterD(); }, function (value) { return _this.setRegisterD(value); }],
                [function () { return _this.getRegisterE(); }, function (value) { return _this.setRegisterE(value); }],
                [function () { return _this.getRegisterH(); }, function (value) { return _this.setRegisterH(value); }],
                [function () { return _this.getRegisterL(); }, function (value) { return _this.setRegisterL(value); }],
                [function () { return _this.bus.read(_this.getRegisterHL()); }, function (value) { return _this.bus.write(_this.getRegisterHL(), value); }],
                [function () { return _this.getRegisterA(); }, function (value) { return _this.setRegisterA(value); }],
            ];
            _this.increasePC();
            var operation = _this.bus.read(_this.getPC());
            _this.increasePC();
            var cbRow = operation >> 4;
            // left side of operations table = 0, right side = 1
            var side = (operation & 0x0f) > 7 ? 1 : 0;
            var operand = (operation & 0x0f) % 0x8;
            var cycles = 0;
            var operationExec = cbops_1.CBOps.opsTable[cbRow][side];
            if (operationExec) {
                cycles = operationExec(operands[operand][0], operands[operand][1], _this);
                _this.tick(cycles);
                // special ops with 12 ticks
                var twelveTickOperations = [0x46, 0x56, 0x66, 0x76, 0x4e, 0x5e, 0x6e, 0x7e];
                // extra cycles for (HL) operations
                if (((operation & 0xf) === 0x6 || (operation & 0xf) === 0xe) &&
                    twelveTickOperations.includes(operation) === false) {
                    // it's always 8 extra ticks for these
                    _this.tick(8);
                }
                else if (((operation & 0xf) === 0x6 || (operation & 0xf) === 0xe) &&
                    twelveTickOperations.includes(operation) === true) {
                    _this.tick(4);
                }
            }
            else {
                throw new Error("cb operation ".concat((0, utils_1.toHexString)(operation), " not implemented"));
            }
            return cycles;
        };
        // 0xCC: CALL Z,a16
        this.callZa16 = function () {
            _this.increasePC();
            _this.tick(4);
            // get address
            var lsb = _this.bus.read(_this.getPC());
            _this.tick(4);
            _this.increasePC();
            var msb = _this.bus.read(_this.getPC());
            _this.tick(4);
            _this.increasePC();
            var address = (msb << 8) + lsb;
            if (_this.getFlagZ() === 1) {
                // back up current address and jump to location
                var currentPC = _this.getPC();
                _this.tick(4);
                var pcLsb = currentPC & 0xff;
                var pcMsb = (currentPC >> 8) & 0xff;
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcMsb);
                _this.tick(4);
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcLsb);
                _this.tick(4);
                _this.setPC(address);
                return true;
            }
            return false;
        };
        // 0xCD: CALL a16, unconditional call of 16 bit address
        this.calla16 = function () {
            _this.increasePC();
            _this.tick(4);
            var addrLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var addrMsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (addrMsb << 8) + addrLsb;
            // Store PC to the stack
            var currentPC = _this.getPC();
            var pcLsb = currentPC & 0xff;
            var pcMsb = (currentPC >> 8) & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.tick(4);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.tick(4);
            _this.setPC(address);
            _this.tick(4);
        };
        // 0xCE: ADC A, d8
        this.addcAD8 = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.bus.read(_this.getPC());
            _this.increasePC();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a + value + carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 0;
            var cFlag = a + value + carry > 0xff ? 1 : 0;
            var hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xCF RST 08H - restart to absolute fixed address
        this.rst08H = function () {
            _this.increasePC();
            var address = 0x08;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xD0: RET NC
        this.retNC = function () {
            _this.increasePC();
            _this.tick(8);
            if (_this.getFlagC() === 0) {
                var addressLsb = _this.bus.read(_this.getSP());
                _this.tick(4);
                _this.increaseSP();
                var addressMsb = _this.bus.read(_this.getSP());
                _this.tick(4);
                _this.increaseSP();
                var address = (addressMsb << 8) + addressLsb;
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xD1: POP DE
        this.popDE = function () {
            _this.increasePC();
            _this.tick(4);
            var dataLsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var dataMsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            var data = (dataMsb << 8) + dataLsb;
            _this.setRegisterDE(data);
            _this.tick(4);
        };
        this.push16 = function (value) {
            _this.increasePC();
            var valueLsb = value & 0xff;
            var valueMsb = (value >> 8) & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), valueMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), valueLsb);
            _this.tick(16);
        };
        // 0xD2: JP NC,a16
        this.jpNCa16 = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var addressMsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (addressMsb << 8) + addressLsb;
            if (_this.getFlagC() === 0) {
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xD4: CALL NC, a16
        this.callNCa16 = function () {
            _this.increasePC();
            _this.tick(4);
            // get address
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (msb << 8) + lsb;
            if (_this.getFlagC() === 0) {
                // back up current address and jump to location
                var currentPC = _this.getPC();
                var pcLsb = currentPC & 0xff;
                var pcMsb = (currentPC >> 8) & 0xff;
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcMsb);
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcLsb);
                _this.setPC(address);
                _this.tick(12);
                return true;
            }
            return false;
        };
        // 0xD5: PUSH DE
        this.pushDE = function () {
            _this.push16(_this.getRegisterDE());
        };
        // 0xD6: SUB d8
        this.subD8 = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var v = _this.bus.read(_this.getPC());
            _this.increasePC();
            var result = (a - v) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 1;
            var cFlag = a - v < 0 ? 1 : 0;
            var hFlag = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // 0xD7 RST 10H - restart to absolute fixed address
        this.rst10H = function () {
            _this.increasePC();
            var address = 0x10;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xD8 RET C
        this.retC = function () {
            _this.increasePC();
            _this.tick(8);
            if (_this.getFlagC() === 1) {
                var addressLsb = _this.bus.read(_this.getSP());
                _this.tick(4);
                _this.increaseSP();
                var addressMsb = _this.bus.read(_this.getSP());
                _this.tick(4);
                _this.increaseSP();
                var address = (addressMsb << 8) + addressLsb;
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xD9: RETI, unconditional return from interrupt, sets ime to 1
        this.reti = function () {
            _this.increasePC(); // not really needed
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var addressMsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var address = (addressMsb << 8) + addressLsb;
            _this.setPC(address);
            _this.tick(4);
            _this.interrupts.enableInterrupts();
        };
        // 0xDA: JP C,a16
        this.jpCa16 = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var addressMsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (addressMsb << 8) + addressLsb;
            if (_this.getFlagC() === 1) {
                _this.setPC(address);
                _this.tick(4);
                return true;
            }
            else {
                return false;
            }
        };
        // 0xDC: CALL C,a16
        this.callCa16 = function () {
            _this.increasePC();
            _this.tick(4);
            // get address
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (msb << 8) + lsb;
            if (_this.getFlagC() === 1) {
                // back up current address and jump to location
                var currentPC = _this.getPC();
                var pcLsb = currentPC & 0xff;
                var pcMsb = (currentPC >> 8) & 0xff;
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcMsb);
                _this.decreaseSP();
                _this.bus.write(_this.getRegisterSP(), pcLsb);
                _this.setPC(address);
                _this.tick(12);
                return true;
            }
            return false;
        };
        // 0xDE: SBC A,d8
        this.sbcAd8 = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var n = _this.bus.read(_this.getPC());
            _this.increasePC();
            var result = (a - n - carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 1;
            var hFlag = (a & 0xf) - (n & 0xf) - carry < 0 ? 1 : 0;
            var cFlag = (a & 0xff) - (n & 0xff) - carry < 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // 0xDF RST 18H - restart to absolute fixed address
        this.rst18H = function () {
            _this.increasePC();
            var address = 0x18;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xE0: load A into the specified 8 bit address + 0xFF00
        this.ldha8A = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = 0xff00 | addressLsb;
            var value = _this.getRegisterA();
            _this.bus.write(address, value);
            _this.tick(4);
        };
        // 0xE1: POP HL
        this.popHL = function () {
            _this.increasePC();
            _this.tick(4);
            var dataLsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var dataMsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var data = (dataMsb << 8) + dataLsb;
            _this.setRegisterHL(data);
        };
        // 0xE2: LD (C),A, load whatever is in A to address +0xFF00 in C
        this.ldCaddrA = function () {
            _this.increasePC();
            var addressLsb = _this.getRegisterC();
            var address = 0xff00 + addressLsb;
            var value = _this.getRegisterA();
            _this.bus.write(address, value);
            _this.tick(8);
        };
        // 0xE5: PUSH HL
        this.pushHL = function () {
            _this.push16(_this.getRegisterHL());
        };
        // 0xE6: AND d8
        this.andd8 = function () {
            _this.increasePC();
            _this.tick(4);
            var n = _this.bus.read(_this.getPC());
            _this.increasePC();
            var result = _this.getRegisterA() & n;
            _this.setRegisterA(result);
            if (result === 0) {
                _this.setFlagZ(1);
            }
            else {
                _this.setFlagZ(0);
            }
            _this.setFlagN(0);
            _this.setFlagH(1);
            _this.setFlagC(0);
            _this.tick(4);
        };
        // 0xE7 RST 20H - restart to absolute fixed address
        this.rst20H = function () {
            _this.increasePC();
            var address = 0x20;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xE8: ADD SP,r8
        this.addSPr8 = function () {
            _this.increasePC();
            _this.tick(4);
            var relativeAddressUnsigned = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var relativeAddressSigned = (0, utils_1.signedFrom8Bits)(relativeAddressUnsigned);
            var sp = _this.getSP();
            var result = (sp + relativeAddressSigned) & 0xffff;
            _this.setRegisterSP(result);
            var zFlag = 0;
            var nFlag = 0;
            var cFlag = (sp & 0xff) + (relativeAddressSigned & 0xff) > 0xff ? 1 : 0;
            var hFlag = (sp & 0xf) + (relativeAddressSigned & 0xf) > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(8);
        };
        // 0xE9: JP (HL), unconditional jump to 16bit address
        this.jpUnconditionalHl = function () {
            _this.increasePC();
            // get address
            var address = _this.getRegisterHL();
            _this.setPC(address);
            _this.tick(4);
        };
        // 0xEA: load A to 16 bit address defined by immediate
        this.lda16A = function () {
            _this.increasePC();
            _this.tick(4);
            var value = _this.getRegisterA();
            // get address
            var lsb = _this.bus.read(_this.getPC());
            _this.tick(4);
            _this.increasePC();
            var msb = _this.bus.read(_this.getPC());
            _this.tick(4);
            _this.increasePC();
            var address = (msb << 8) + lsb;
            _this.bus.write(address, value);
            _this.tick(4);
        };
        // 0xEE: XOR d8
        this.xord8 = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var r = _this.bus.read(_this.getRegisterPC());
            _this.increasePC();
            var result = a ^ r;
            _this.setRegisterA(result);
            // Set Z flag
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.tick(4);
        };
        // 0xEF RST 28H - restart to absolute fixed address
        this.rst28H = function () {
            _this.increasePC();
            var address = 0x28;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xF0: load value specified in 8 bit address + 0xFF00 into A
        this.ldhAa8 = function () {
            _this.increasePC();
            _this.tick(4);
            var addressLsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = 0xff00 | addressLsb;
            var value = _this.bus.read(address);
            _this.tick(4);
            _this.setRegisterA(value);
        };
        // 0xF1: POP AF
        this.popAF = function () {
            _this.increasePC();
            _this.tick(4);
            var dataLsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var dataMsb = _this.bus.read(_this.getSP());
            _this.increaseSP();
            _this.tick(4);
            var data = (dataMsb << 8) + dataLsb;
            _this.setRegisterAF(data & 0xfff0); // this command impacts the flags, last 4 bits are always 0
        };
        // 0xF2: LD A,(C)
        this.ldACAddr = function () {
            _this.increasePC();
            _this.tick(4);
            var address = 0xff00 | _this.getRegisterC();
            var value = _this.bus.read(address);
            _this.setRegisterA(value);
            _this.tick(4);
        };
        // 0xF3: DI disable interrupts
        this.di = function () {
            _this.increasePC();
            _this.tick(4);
            _this.interrupts.disableInterrupts();
        };
        // 0xF5: PUSH AF
        this.pushAF = function () {
            _this.push16(_this.getRegisterAF());
        };
        // 0xF6: OR d8
        this.ord8 = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var v = _this.bus.read(_this.getPC());
            _this.increasePC();
            var result = a | v;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(0);
            _this.setFlagC(0);
            _this.setFlagH(0);
            _this.tick(4);
        };
        // 0xF8 LD HL,SP+r8
        this.ldHLSPr8 = function () {
            _this.increasePC();
            _this.tick(4);
            var e = (0, utils_1.signedFrom8Bits)(_this.bus.read(_this.getPC()));
            _this.increasePC();
            var sp = _this.getSP();
            var result = (sp + e) & 0xffff;
            _this.setRegisterHL(result);
            var zFlag = 0;
            var nFlag = 0;
            var cFlag = (sp & 0xff) + (e & 0xff) > 0xff ? 1 : 0;
            var hFlag = (sp & 0xf) + (e & 0xf) > 0xf ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(8);
        };
        // 0xF7 RST 30H - restart to absolute fixed address
        this.rst30H = function () {
            _this.increasePC();
            var address = 0x30;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xF9: LD SP,HL
        this.ldSPHL = function () {
            _this.increasePC();
            _this.setRegisterSP(_this.getRegisterHL());
            _this.tick(8);
        };
        // 0xFA: LD A,(a16)
        this.ldAa16 = function () {
            _this.increasePC();
            _this.tick(4);
            var lsb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var msb = _this.bus.read(_this.getPC());
            _this.increasePC();
            _this.tick(4);
            var address = (msb << 8) + lsb;
            var value = _this.bus.read(address);
            _this.setRegisterA(value);
            _this.tick(4);
        };
        // 0xFE: CP d8
        this.cpd8 = function () {
            _this.increasePC();
            _this.tick(4);
            var a = _this.getRegisterA();
            var n = _this.bus.read(_this.getPC());
            _this.increasePC();
            var result = (a - n) & 0xff;
            var zFlag = result === 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(1);
            // check if the lower bytes rolled over
            var hFlag = (a & 0xf) - (n & 0xf) < 0 ? 1 : 0;
            _this.setFlagH(hFlag);
            // check if the entire substraction rolls over
            var cFlag = a - n < 0 ? 1 : 0;
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // 0xFF RST 38H - restart to absolute fixed address
        this.rst38H = function () {
            _this.increasePC();
            var address = 0x38;
            var currentPC = _this.getPC();
            var pcMsb = (currentPC >> 8) & 0xff;
            var pcLsb = currentPC & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(address);
            _this.tick(16);
        };
        // 0xFF: enable interrupts at the next cycle
        this.ei = function () {
            _this.increasePC();
            _this.enableInterruptsOnNextCycle = true;
            _this.tick(4);
        };
        // Some more helper functions
        // add helper
        this.add = function (registerValue) {
            _this.increasePC();
            var a = _this.getRegisterA();
            var v = registerValue;
            var result = (a + v) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var hFlag = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
            var cFlag = a + v > 0xff ? 1 : 0;
            _this.setFlagN(0);
            _this.setFlagZ(zFlag);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // sub helper
        this.sub = function (v) {
            _this.increasePC();
            var a = _this.getRegisterA();
            var result = (a - v) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 1;
            var cFlag = a - v < 0 ? 1 : 0;
            var hFlag = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagC(cFlag);
            _this.setFlagH(hFlag);
            _this.tick(4);
        };
        // sbc helper
        this.sbc = function (n) {
            _this.increasePC();
            var a = _this.getRegisterA();
            var carry = _this.getFlagC();
            var result = (a - n - carry) & 0xff;
            _this.setRegisterA(result);
            var zFlag = result === 0 ? 1 : 0;
            var nFlag = 1;
            var hFlag = (a & 0xf) - (n & 0xf) - carry < 0 ? 1 : 0;
            var cFlag = (a & 0xff) - (n & 0xff) - carry < 0 ? 1 : 0;
            _this.setFlagZ(zFlag);
            _this.setFlagN(nFlag);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            _this.tick(4);
        };
        // Helper function for add when the target register is HL.
        this.addHL = function (value) {
            _this.increasePC();
            var hl = _this.getRegisterHL();
            var result = (hl + value) & 0xffff;
            _this.setRegisterHL(result);
            var hFlag = (hl & 0xfff) + (value & 0xfff) > 0xfff ? 1 : 0;
            var cFlag = hl + value > 0xffff ? 1 : 0;
            _this.setFlagN(0);
            _this.setFlagH(hFlag);
            _this.setFlagC(cFlag);
            // the order is not too important here since we're not accessing any timer values in this function.
            _this.tick(8);
        };
        // Another helper function to load what's stored at address provided in HL into another register.
        this.ldRHL = function (setValue) {
            _this.increasePC();
            _this.tick(4);
            var address = _this.getRegisterHL();
            var value = _this.bus.read(address);
            _this.tick(4);
            setValue(value);
        };
        this.callInterrupt = function (interruptHanlderAddress) {
            // Store PC to the stack
            _this.halted = false;
            _this.interrupts.disableInterrupts();
            var currentPC = _this.getPC();
            var pcLsb = currentPC & 0xff;
            var pcMsb = (currentPC >> 8) & 0xff;
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcMsb);
            _this.decreaseSP();
            _this.bus.write(_this.getRegisterSP(), pcLsb);
            _this.setPC(interruptHanlderAddress & 0xffff);
            _this.tick(5 * 4);
        };
        // Instruction lookup table, we're storing the name of an instruction too make debugging easier
        this.instructions = {
            0x00: {
                name: "NOP",
                exec: this.nop,
                size: 1,
            },
            0x01: {
                name: "LD BC,d16",
                exec: this.loadImmediate16ToBC,
                size: 3,
            },
            0x02: {
                name: "LD (BC),A",
                exec: this.ldBCAddrA,
                size: 1,
            },
            0x03: {
                name: "INC BC",
                exec: this.incBC,
                size: 1,
            },
            0x04: {
                name: "INC B",
                exec: this.incB,
                size: 1,
            },
            0x05: {
                name: "DEC B",
                exec: this.decB,
                size: 1,
            },
            0x06: {
                name: "LD B,d8",
                exec: this.loadImmediate8ToB,
                size: 2,
            },
            0x07: {
                name: "RLCA",
                exec: this.rlca,
                size: 1,
            },
            0x08: {
                name: "LD (a16), SP",
                exec: this.lda16SP,
                size: 3,
            },
            0x09: {
                name: "ADD HL,BC",
                exec: this.addHLBC,
                size: 1,
            },
            0x0a: {
                name: "LD A, (BC)",
                exec: this.ldABCAddr,
                size: 1,
            },
            0x0b: {
                name: "DEC BC",
                exec: this.decBC,
                size: 1,
            },
            0x0c: {
                name: "INC C",
                exec: this.incC,
                size: 1,
            },
            0x0d: {
                name: "DEC C",
                exec: this.decC,
                size: 1,
            },
            0x0e: {
                name: "LD C,d8",
                exec: this.loadImmediate8ToC,
                size: 2,
            },
            0x0f: {
                name: "RRCA",
                exec: this.rrca,
                size: 1,
            },
            0x11: {
                name: "LD DE,d16",
                exec: this.loadImmediate16ToDE,
                size: 3,
            },
            0x12: {
                name: "LD (DE), A",
                exec: this.ldDEAddrA,
                size: 1,
            },
            0x13: {
                name: "INC DE",
                exec: this.incDE,
                size: 1,
            },
            0x14: {
                name: "INC D",
                exec: this.incD,
                size: 1,
            },
            0x15: {
                name: "DEC D",
                exec: this.decD,
                size: 1,
            },
            0x16: {
                name: "LD D,d8",
                exec: this.loadImmediate8ToD,
                size: 2,
            },
            0x17: {
                name: "RLA",
                exec: this.rla,
                size: 1,
            },
            0x18: {
                name: "JR r8",
                exec: this.jrR8,
                size: 2,
            },
            0x19: {
                name: "ADD HL,DE",
                exec: this.addHLDE,
                size: 1,
            },
            0x1a: {
                name: "LD A, (DE)",
                exec: this.ldADEAddr,
                size: 1,
            },
            0x1b: {
                name: "DEC DE",
                exec: this.decDE,
                size: 1,
            },
            0x1c: {
                name: "INC E",
                exec: this.incE,
                size: 1,
            },
            0x1d: {
                name: "DEC E",
                exec: this.decE,
                size: 1,
            },
            0x1e: {
                name: "LD E,d8",
                exec: this.loadImmediate8ToE,
                size: 2,
            },
            0x1f: {
                name: "RRA",
                exec: this.rra,
                size: 1,
            },
            0x20: {
                name: "JR NZ,r8",
                exec: this.jrNzR8,
                size: 2,
            },
            0x21: {
                name: "LD HL,d16",
                exec: this.loadImmediate16ToHL,
                size: 3,
            },
            0x22: {
                name: "LD (HL+), A",
                exec: this.loadFromAccumulatorIndirecHLIncrement,
                size: 1,
            },
            0x23: {
                name: "INC HL",
                exec: this.incHL,
                size: 1,
            },
            0x24: {
                name: "INC H",
                exec: this.incH,
                size: 1,
            },
            0x25: {
                name: "DEC H",
                exec: this.decH,
                size: 1,
            },
            0x26: {
                name: "LD H,d8",
                exec: this.loadImmediate8ToH,
                size: 2,
            },
            0x27: {
                name: "DAA",
                exec: this.daa,
                size: 1,
            },
            0x28: {
                name: "JR Z,r8",
                exec: this.jrZr8,
                size: 2,
            },
            0x29: {
                name: "ADD HL,HL",
                exec: this.addHLHL,
                size: 1,
            },
            0x2a: {
                name: "LD A,(HL+)",
                exec: this.ldAHLPlus,
                size: 1,
            },
            0x2b: {
                name: "DEC HL",
                exec: this.decHL,
                size: 1,
            },
            0x2c: {
                name: "INC L",
                exec: this.incL,
                size: 1,
            },
            0x2d: {
                name: "DEC L",
                exec: this.decL,
                size: 1,
            },
            0x2e: {
                name: "LD L,d8",
                exec: this.loadImmediate8ToL,
                size: 2,
            },
            0x2f: {
                name: "CPL",
                exec: this.cpl,
                size: 1,
            },
            0x30: {
                name: "JR NC,r8",
                exec: this.jrNCR8,
                size: 2,
            },
            0x31: {
                name: "LD SP,d16",
                exec: this.loadImmediate16ToSP,
                size: 3,
            },
            0x32: {
                name: "LD (HL-),A",
                exec: this.loadFromAccumulatorIndirecHLDecrement,
                size: 1,
            },
            0x33: {
                name: "INC SP",
                exec: this.incSP,
                size: 1,
            },
            0x34: {
                name: "INC (HL)",
                exec: this.incHLAddr,
                size: 1,
            },
            0x35: {
                name: "DEC (HL)",
                exec: this.decHLAddr,
                size: 1,
            },
            0x36: {
                name: "LD (HL),d8",
                exec: this.loadImmediateToAddressInHL,
                size: 2,
            },
            0x37: {
                name: "SCF",
                exec: this.scf,
                size: 1,
            },
            0x38: {
                name: "JR C,r8",
                exec: this.jrCr8,
                size: 2,
            },
            0x39: {
                name: "ADD HL,SP",
                exec: this.addHLSP,
                size: 1,
            },
            0x3a: {
                name: "LD A,(HL-)",
                exec: this.ldAHLMinus,
                size: 1,
            },
            0x3b: {
                name: "DEC SP",
                exec: this.decSP,
                size: 1,
            },
            0x3c: {
                name: "INC A",
                exec: this.incA,
                size: 1,
            },
            0x3d: {
                name: "DEC A",
                exec: this.decA,
                size: 1,
            },
            0x3e: {
                name: "LD A,d8",
                exec: this.loadImmediate8ToA,
                size: 2,
            },
            0x3f: {
                name: "CCF",
                exec: this.ccf,
                size: 1,
            },
            0x40: {
                name: "LD B,B",
                exec: this.ldBB,
                size: 1,
            },
            0x41: {
                name: "LD B,C",
                exec: this.ldBC,
                size: 1,
            },
            0x42: {
                name: "LD B,D",
                exec: this.ldBD,
                size: 1,
            },
            0x43: {
                name: "LD B,E",
                exec: this.ldBE,
                size: 1,
            },
            0x44: {
                name: "LD B,H",
                exec: this.ldBH,
                size: 1,
            },
            0x45: {
                name: "LD B,L",
                exec: this.ldBL,
                size: 1,
            },
            0x46: {
                name: "LD B, (HL)",
                exec: this.ldBHLAddr,
                size: 1,
            },
            0x47: {
                name: "LD B,A",
                exec: this.ldBA,
                size: 1,
            },
            0x48: {
                name: "LD C,B",
                exec: this.ldCB,
                size: 1,
            },
            0x49: {
                name: "LD C,C",
                exec: this.ldCC,
                size: 1,
            },
            0x4a: {
                name: "LD C,D",
                exec: this.ldCD,
                size: 1,
            },
            0x4b: {
                name: "LD C,E",
                exec: this.ldCE,
                size: 1,
            },
            0x4c: {
                name: "LD C,H",
                exec: this.ldCH,
                size: 1,
            },
            0x4d: {
                name: "LD C,L",
                exec: this.ldCL,
                size: 1,
            },
            0x4e: {
                name: "LD C, (HL)",
                exec: this.ldCHLAddr,
                size: 1,
            },
            0x4f: {
                name: "LD C,A",
                exec: this.ldCA,
                size: 1,
            },
            0x50: {
                name: "LD D,B",
                exec: this.ldDB,
                size: 1,
            },
            0x51: {
                name: "LD D,C",
                exec: this.ldDC,
                size: 1,
            },
            0x52: {
                name: "LD D,D",
                exec: this.ldDD,
                size: 1,
            },
            0x53: {
                name: "LD D,E",
                exec: this.ldDE,
                size: 1,
            },
            0x54: {
                name: "LD D,H",
                exec: this.ldDH,
                size: 1,
            },
            0x55: {
                name: "LD D,L",
                exec: this.ldDL,
                size: 1,
            },
            0x57: {
                name: "LD D,A",
                exec: this.ldDA,
                size: 1,
            },
            0x56: {
                name: "LD D, (HL)",
                exec: this.ldDHLAddr,
                size: 1,
            },
            0x58: {
                name: "LD E,B",
                exec: this.ldEB,
                size: 1,
            },
            0x59: {
                name: "LD E,C",
                exec: this.ldEC,
                size: 1,
            },
            0x5a: {
                name: "LD E,D",
                exec: this.ldED,
                size: 1,
            },
            0x5b: {
                name: "LD E,E",
                exec: this.ldEE,
                size: 1,
            },
            0x5c: {
                name: "LD E,H",
                exec: this.ldEH,
                size: 1,
            },
            0x5d: {
                name: "LD E,L",
                exec: this.ldEL,
                size: 1,
            },
            0x5e: {
                name: "LD E, (HL)",
                exec: this.ldEHLAddr,
                size: 1,
            },
            0x5f: {
                name: "LD E,A",
                exec: this.ldEA,
                size: 1,
            },
            0x60: {
                name: "LD H,B",
                exec: this.ldHB,
                size: 1,
            },
            0x61: {
                name: "LD H,C",
                exec: this.ldHC,
                size: 1,
            },
            0x62: {
                name: "LD H,D",
                exec: this.ldHD,
                size: 1,
            },
            0x63: {
                name: "LD H,E",
                exec: this.ldHE,
                size: 1,
            },
            0x64: {
                name: "LD H,H",
                exec: this.ldHH,
                size: 1,
            },
            0x65: {
                name: "LD H,L",
                exec: this.ldHL,
                size: 1,
            },
            0x66: {
                name: "LD H, (HL)",
                exec: this.ldHHLAddr,
                size: 1,
            },
            0x67: {
                name: "LD H,A",
                exec: this.ldHA,
                size: 1,
            },
            0x68: {
                name: "LD L,B",
                exec: this.ldLB,
                size: 1,
            },
            0x69: {
                name: "LD L,C",
                exec: this.ldLC,
                size: 1,
            },
            0x6a: {
                name: "LD L,D",
                exec: this.ldLD,
                size: 1,
            },
            0x6b: {
                name: "LD L,E",
                exec: this.ldLE,
                size: 1,
            },
            0x6c: {
                name: "LD L,H",
                exec: this.ldLH,
                size: 1,
            },
            0x6d: {
                name: "LD L,L",
                exec: this.ldLL,
                size: 1,
            },
            0x6e: {
                name: "LD L, (HL)",
                exec: this.ldLHLAddr,
                size: 1,
            },
            0x6f: {
                name: "LD L,A",
                exec: this.ldLA,
                size: 1,
            },
            0x70: {
                name: "LD (HL), B",
                exec: this.ldHLAddrB,
                size: 1,
            },
            0x71: {
                name: "LD (HL), C",
                exec: this.ldHLAddrC,
                size: 1,
            },
            0x72: {
                name: "LD (HL), D",
                exec: this.ldHLAddrD,
                size: 1,
            },
            0x73: {
                name: "LD (HL), E",
                exec: this.ldHLAddrE,
                size: 1,
            },
            0x74: {
                name: "LD (HL), H",
                exec: this.ldHLAddrH,
                size: 1,
            },
            0x75: {
                name: "LD (HL), L",
                exec: this.ldHLAddrL,
                size: 1,
            },
            0x76: {
                name: "HALT",
                exec: this.halt,
                size: 1,
            },
            0x77: {
                name: "LD (HL), A",
                exec: this.ldHLAddrA,
                size: 1,
            },
            0x78: {
                name: "LD A,B",
                exec: this.ldAB,
                size: 1,
            },
            0x79: {
                name: "LD A,C",
                exec: this.ldAC,
                size: 1,
            },
            0x7a: {
                name: "LD A,D",
                exec: this.ldAD,
                size: 1,
            },
            0x7b: {
                name: "LD A,E",
                exec: this.ldAE,
                size: 1,
            },
            0x7c: {
                name: "LD A,H",
                exec: this.ldAH,
                size: 1,
            },
            0x7d: {
                name: "LD A,L",
                exec: this.ldAL,
                size: 1,
            },
            0x7e: {
                name: "LD A, (HL)",
                exec: this.ldAHLAddr,
                size: 1,
            },
            0x7f: {
                name: "LD A,A",
                exec: this.ldAA,
                size: 1,
            },
            0x80: {
                name: "ADD A,B",
                exec: this.addAB,
                size: 1,
            },
            0x81: {
                name: "ADD A,C",
                exec: this.addAC,
                size: 1,
            },
            0x82: {
                name: "ADD A,D",
                exec: this.addAD,
                size: 1,
            },
            0x83: {
                name: "ADD A,E",
                exec: this.addAE,
                size: 1,
            },
            0x84: {
                name: "ADD A,H",
                exec: this.addAH,
                size: 1,
            },
            0x85: {
                name: "ADD A,L",
                exec: this.addAL,
                size: 1,
            },
            0x86: {
                name: "ADD A,(HL)",
                exec: this.addAHLAddr,
                size: 1,
            },
            0x87: {
                name: "ADD A,A",
                exec: this.addAA,
                size: 1,
            },
            0x88: {
                name: "ADC A,B",
                exec: this.addcAB,
                size: 1,
            },
            0x89: {
                name: "ADC A,C",
                exec: this.addcAC,
                size: 1,
            },
            0x8a: {
                name: "ADC A,D",
                exec: this.addcAD,
                size: 1,
            },
            0x8b: {
                name: "ADC A,E",
                exec: this.addcAE,
                size: 1,
            },
            0x8c: {
                name: "ADC A,H",
                exec: this.addcAH,
                size: 1,
            },
            0x8d: {
                name: "ADC A,L",
                exec: this.addcAL,
                size: 1,
            },
            0x8e: {
                name: "ADC A,(HL)",
                exec: this.addcAHLAddr,
                size: 1,
            },
            0x8f: {
                name: "ADC A,A",
                exec: this.addcAA,
                size: 1,
            },
            0x90: {
                name: "SUB B",
                exec: this.subB,
                size: 1,
            },
            0x91: {
                name: "SUB C",
                exec: this.subC,
                size: 1,
            },
            0x92: {
                name: "SUB D",
                exec: this.subD,
                size: 1,
            },
            0x93: {
                name: "SUB E",
                exec: this.subE,
                size: 1,
            },
            0x94: {
                name: "SUB H",
                exec: this.subH,
                size: 1,
            },
            0x95: {
                name: "SUB L",
                exec: this.subL,
                size: 1,
            },
            0x96: {
                name: "SUB (HL)",
                exec: this.subHLAddr,
                size: 1,
            },
            0x97: {
                name: "SUB A",
                exec: this.subA,
                size: 1,
            },
            0x98: {
                name: "SBC A,B",
                exec: this.sbcAB,
                size: 1,
            },
            0x99: {
                name: "SBC A,C",
                exec: this.sbcAC,
                size: 1,
            },
            0x9a: {
                name: "SBC A,D",
                exec: this.sbcAD,
                size: 1,
            },
            0x9b: {
                name: "SBC A,E",
                exec: this.sbcAE,
                size: 1,
            },
            0x9c: {
                name: "SBC A,H",
                exec: this.sbcAH,
                size: 1,
            },
            0x9d: {
                name: "SBC A,L",
                exec: this.sbcAL,
                size: 1,
            },
            0x9e: {
                name: "SBC A,(HL)",
                exec: this.sbcAHLAddr,
                size: 1,
            },
            0x9f: {
                name: "SBC A,A",
                exec: this.sbcAA,
                size: 1,
            },
            0xa0: {
                name: "AND B",
                exec: this.andB,
                size: 1,
            },
            0xa1: {
                name: "AND C",
                exec: this.andC,
                size: 1,
            },
            0xa2: {
                name: "AND D",
                exec: this.andD,
                size: 1,
            },
            0xa3: {
                name: "AND E",
                exec: this.andE,
                size: 1,
            },
            0xa4: {
                name: "AND H",
                exec: this.andH,
                size: 1,
            },
            0xa5: {
                name: "AND L",
                exec: this.andL,
                size: 1,
            },
            0xa6: {
                name: "AND (HL)",
                exec: this.andHLAddr,
                size: 1,
            },
            0xa7: {
                name: "AND A",
                exec: this.andA,
                size: 1,
            },
            0xa8: {
                name: "XOR B",
                exec: this.xorRegisterB,
                size: 1,
            },
            0xa9: {
                name: "XOR C",
                exec: this.xorRegisterC,
                size: 1,
            },
            0xaa: {
                name: "XOR D",
                exec: this.xorRegisterD,
                size: 1,
            },
            0xab: {
                name: "XOR E",
                exec: this.xorRegisterE,
                size: 1,
            },
            0xac: {
                name: "XOR H",
                exec: this.xorRegisterH,
                size: 1,
            },
            0xad: {
                name: "XOR L",
                exec: this.xorRegisterL,
                size: 1,
            },
            0xae: {
                name: "XOR (HL)",
                exec: this.xorHLAddr,
                size: 1,
            },
            0xaf: {
                name: "XOR A",
                exec: this.xorRegisterA,
                size: 1,
            },
            0xb0: {
                name: "OR B",
                exec: this.orB,
                size: 1,
            },
            0xb1: {
                name: "OR C",
                exec: this.orC,
                size: 1,
            },
            0xb2: {
                name: "OR D",
                exec: this.orD,
                size: 1,
            },
            0xb3: {
                name: "OR E",
                exec: this.orE,
                size: 1,
            },
            0xb4: {
                name: "OR H",
                exec: this.orH,
                size: 1,
            },
            0xb5: {
                name: "OR L",
                exec: this.orL,
                size: 1,
            },
            0xb6: {
                name: "OR (HL)",
                exec: this.orHLAddr,
                size: 1,
            },
            0xb7: {
                name: "OR A",
                exec: this.orA,
                size: 1,
            },
            0xb8: {
                name: "CP B",
                exec: this.cpB,
                size: 1,
            },
            0xb9: {
                name: "CP C",
                exec: this.cpC,
                size: 1,
            },
            0xba: {
                name: "CP D",
                exec: this.cpD,
                size: 1,
            },
            0xbb: {
                name: "CP E",
                exec: this.cpE,
                size: 1,
            },
            0xbc: {
                name: "CP H",
                exec: this.cpH,
                size: 1,
            },
            0xbd: {
                name: "CP L",
                exec: this.cpL,
                size: 1,
            },
            0xbe: {
                name: "CP (HL)",
                exec: this.cpHLAddr,
                size: 1,
            },
            0xbf: {
                name: "CP A",
                exec: this.cpA,
                size: 1,
            },
            0xc0: {
                name: "RET NZ",
                exec: this.retNZ,
                size: 1,
            },
            0xc1: {
                name: "POP BC",
                exec: this.popBC,
                size: 1,
            },
            0xc2: {
                name: "JP NZ,a16",
                exec: this.jpNZa16,
                size: 3,
            },
            0xc3: {
                name: "JP a16",
                exec: this.jpUnconditional,
                size: 3,
            },
            0xc4: {
                name: "CALL NZ,a16",
                exec: this.callNZa16,
                size: 3,
            },
            0xc5: {
                name: "PUSH BC",
                exec: this.pushBC,
                size: 1,
            },
            0xc6: {
                name: "ADD A,d8",
                exec: this.addAd8,
                size: 2,
            },
            0xc7: {
                name: "RST 00H",
                exec: this.rst00H,
                size: 1,
            },
            0xc8: {
                name: "RET Z",
                exec: this.retZ,
                size: 1,
            },
            0xc9: {
                name: "RET",
                exec: this.ret,
                size: 1,
            },
            0xca: {
                name: "JP Z, a16",
                exec: this.jpZa16,
                size: 3,
            },
            0xcb: {
                name: "CB",
                exec: this.cb,
                size: 2,
            },
            0xcc: {
                name: "CALL Z,a16",
                exec: this.callZa16,
                size: 3,
            },
            0xcd: {
                name: "CALL a16",
                exec: this.calla16,
                size: 3,
            },
            0xce: {
                name: "ADC A,d8",
                exec: this.addcAD8,
                size: 2,
            },
            0xcf: {
                name: "RST 08H",
                exec: this.rst08H,
                size: 1,
            },
            0xd0: {
                name: "RET NC",
                exec: this.retNC,
                size: 1,
            },
            0xd1: {
                name: "POP DE",
                exec: this.popDE,
                size: 1,
            },
            0xd2: {
                name: "JP NC,a16",
                exec: this.jpNCa16,
                size: 3,
            },
            0xd4: {
                name: "CALL NC,a16",
                exec: this.callNCa16,
                size: 3,
            },
            0xd5: {
                name: "PUSH DE",
                exec: this.pushDE,
                size: 1,
            },
            0xd6: {
                name: "SUB d8",
                exec: this.subD8,
                size: 2,
            },
            0xd7: {
                name: "RST 10H",
                exec: this.rst10H,
                size: 1,
            },
            0xd8: {
                name: "RET C",
                exec: this.retC,
                size: 1,
            },
            0xd9: {
                name: "RETI",
                exec: this.reti,
                size: 1,
            },
            0xda: {
                name: "JP C,a16",
                exec: this.jpCa16,
                size: 3,
            },
            0xdc: {
                name: "CALL C,a16",
                exec: this.callCa16,
                size: 3,
            },
            0xde: {
                name: "SBC A,d8",
                exec: this.sbcAd8,
                size: 2,
            },
            0xdf: {
                name: "RST 18H",
                exec: this.rst18H,
                size: 1,
            },
            0xe0: {
                name: "LDH (a8), A",
                exec: this.ldha8A,
                size: 2,
            },
            0xe1: {
                name: "POP HL",
                exec: this.popHL,
                size: 1,
            },
            0xe2: {
                name: "LD (C),A",
                exec: this.ldCaddrA,
                size: 1,
            },
            0xe5: {
                name: "PUSH HL",
                exec: this.pushHL,
                size: 1,
            },
            0xe6: {
                name: "AND d8",
                exec: this.andd8,
                size: 2,
            },
            0xe7: {
                name: "RST 20H",
                exec: this.rst20H,
                size: 1,
            },
            0xe8: {
                name: "ADD SP,r8",
                exec: this.addSPr8,
                size: 2,
            },
            0xe9: {
                name: "JP (HL)",
                exec: this.jpUnconditionalHl,
                size: 1,
            },
            0xea: {
                name: "LD (a16),A",
                exec: this.lda16A,
                size: 3,
            },
            0xee: {
                name: "XOR d8",
                exec: this.xord8,
                size: 2,
            },
            0xef: {
                name: "RST 28H",
                exec: this.rst28H,
                size: 1,
            },
            0xf0: {
                name: "LDH A, (a8)",
                exec: this.ldhAa8,
                size: 2,
            },
            0xf1: {
                name: "POP AF",
                exec: this.popAF,
                size: 1,
            },
            0xf2: {
                name: "LD (C),A",
                exec: this.ldACAddr,
                size: 1,
            },
            0xf3: {
                name: "DI",
                exec: this.di,
                size: 1,
            },
            0xf5: {
                name: "PUSH AF",
                exec: this.pushAF,
                size: 1,
            },
            0xf6: {
                name: "OR d8",
                exec: this.ord8,
                size: 2,
            },
            0xf7: {
                name: "RST 30H",
                exec: this.rst30H,
                size: 1,
            },
            0xf8: {
                name: "LD HL,SP+r8",
                exec: this.ldHLSPr8,
                size: 2,
            },
            0xf9: {
                name: "LD SP,HL",
                exec: this.ldSPHL,
                size: 1,
            },
            0xfa: {
                name: "LD A, (a16)",
                exec: this.ldAa16,
                size: 3,
            },
            0xfb: {
                name: "EI",
                exec: this.ei,
                size: 1,
            },
            0xfe: {
                name: "CP d8",
                exec: this.cpd8,
                size: 2,
            },
            0xff: {
                name: "RST 38H",
                exec: this.rst38H,
                size: 1,
            },
        };
    }
    CPU.prototype.run = function () {
        var _this = this;
        // Set timeout has such a strong latency that we have to measure the time here
        this.startTimeMs = performance.now();
        while (this.cyclesThisFrame < this.cyclesPerFrame && !this.killed) {
            if (this.debugging) {
                console.log("debugging mode entered");
                console.log(this.getNextFewBytes());
                this.ppu.logDebugInfo();
                return;
            }
            this.step();
        }
        this.cyclesThisFrame = 0;
        var timeTakenMs = performance.now() - this.startTimeMs;
        setTimeout(function () {
            if (!_this.killed) {
                _this.run();
            }
            // ms hack to compensate for set timeout, we don't want to sound to fluctuate too much which is why we dont' want this value to change too often
            // we should actually measure this
        }, 
        // Todo(put the timing back in)
        this.timePerFrameMs - (timeTakenMs + 0));
    };
    CPU.prototype.step = function (logStatements) {
        if (logStatements === void 0) { logStatements = false; }
        if (!this.halted) {
            // just for debugging
            var nextFewBytesString = this.getNextFewBytes();
            // Fetch next instruction
            var pc = this.getPC();
            var instructionNo = this.bus.read(pc);
            var instruction = this.instructions[instructionNo];
            // Throw error in case we ran into an instruction that hasn't been implemented yet.
            if (!instruction) {
                console.log("".concat(this.instructionCount, ":----------------"));
                this.printRegisters();
                this.printFlags();
                console.log("".concat((0, utils_1.toHexString)(pc, 16), "\t").concat((0, utils_1.toHexString)(instructionNo), " (").concat(nextFewBytesString, ")"));
                this.printLastOperations();
                console.log("following instructions were used: ");
                Array.from(this.usedInstructions)
                    .sort()
                    .forEach(function (inst, i) { return console.log(i + ": " + inst); });
                throw Error("Unknown instruction encountered: ".concat((0, utils_1.toHexString)(instructionNo)));
            }
            try {
                if (this.debugging) {
                    console.log("%cDebugger - executing instruction ".concat(instruction.name), "background: #000000; color: #ffffff");
                    console.log("Flags and registers before:");
                    this.printRegisters();
                    this.printFlags();
                }
                var extraInfo = "";
                if (instructionNo === 0xfe) {
                    extraInfo = "; d8 = " + (0, utils_1.toHexString)(this.bus.read(this.getPC() + 1));
                }
                if (instructionNo === 0xe9) {
                    extraInfo = "; address in HL = " + (0, utils_1.toHexString)(this.getRegisterHL());
                }
                this.lastXOperations.push(this.instructionCount +
                    " -> pc: " +
                    (0, utils_1.toHexString)(pc) +
                    ", instr: " +
                    instruction.name +
                    "(" +
                    (0, utils_1.toHexString)(instructionNo) +
                    ")" +
                    extraInfo);
                this.usedInstructions.add(instruction.name);
                if (this.lastXOperations.length > this.maxLastOperations) {
                    this.lastXOperations.shift();
                }
                instruction.exec();
                this.totalExecutedInstructionCount++;
                if (this.debugging) {
                    console.log("Flags and registers after:");
                    this.printRegisters();
                    this.printFlags();
                }
            }
            catch (e) {
                this.printLastOperations();
                throw e;
            }
        }
        else {
            // halted, wake up if if & ie become non zero
            if ((this.interrupts.getInterruptFlag() & this.interrupts.getIE()) > 0) {
                this.halted = false;
            }
            this.tick(4); // Todo: tick 1 or 4 on halted?
        }
        // handle interrupts
        if (this.interrupts.isInterruptsEnabled()) {
            // VBLANK 0x40
            if (this.interrupts.getInterruptFlag() & 0x1 && this.interrupts.getIE() & 0x1) {
                this.lastXOperations.push("vblank interrupt");
                if (this.lastXOperations.length > this.maxLastOperations) {
                    this.lastXOperations.shift();
                }
                // vblank interrupt
                this.callInterrupt(0x40);
                this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 254);
            }
            // LCD / stat 0x48
            else if (this.interrupts.getInterruptFlag() & 2 && this.interrupts.getIE() & 2) {
                this.lastXOperations.push("lcd stat interrupt");
                if (this.lastXOperations.length > this.maxLastOperations) {
                    this.lastXOperations.shift();
                }
                this.callInterrupt(0x48);
                this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 253);
            }
            // Timer / stat 0x50
            else if (this.interrupts.getInterruptFlag() & 4 && this.interrupts.getIE() & 4) {
                this.lastXOperations.push("timer stat interrupt");
                if (this.lastXOperations.length > this.maxLastOperations) {
                    this.lastXOperations.shift();
                }
                this.callInterrupt(0x50);
                this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 251);
            }
            // Serial 0x58 -- this shouldnt ever get invoked in our impl
            else if (this.interrupts.getInterruptFlag() & 8 && this.interrupts.getIE() & 8) {
                this.lastXOperations.push("serial interrupt");
                if (this.lastXOperations.length > this.maxLastOperations) {
                    this.lastXOperations.shift();
                }
                this.callInterrupt(0x58);
                this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 247);
            }
            // Joypad 0x60
            else if (this.interrupts.getInterruptFlag() & 16 && this.interrupts.getIE() & 16) {
                this.lastXOperations.push("joypad interrupt");
                if (this.lastXOperations.length > this.maxLastOperations) {
                    this.lastXOperations.shift();
                }
                this.callInterrupt(0x60);
                this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 239);
            }
        }
        if (this.enableInterruptsOnNextCycle) {
            this.enableInterruptsOnNextCycle = false;
            this.interrupts.enableInterrupts();
        }
        if (this.debugging && logStatements) {
            var instructionNo = this.bus.read(this.getPC(), true);
            var instruction = this.instructions[instructionNo];
            console.log("Debugger - next instruction: ".concat(instruction.name));
            console.log("Debugger - next bytes: [".concat((0, utils_1.toHexString)(this.bus.read(this.getPC(), true)), ", ").concat((0, utils_1.toHexString)(this.bus.read(this.getPC() + 1, true)), ", ").concat((0, utils_1.toHexString)(this.bus.read(this.getPC() + 2, true)), "]"));
            console.log("%c-------------------------------------------", "color: #ff0000");
        }
        this.instructionCount++;
    };
    CPU.prototype.startDebug = function () {
        this.debugging = true;
        console.log("following instructions were used: ");
        Array.from(this.usedInstructions)
            .sort()
            .forEach(function (i) { return console.log(i); });
    };
    CPU.prototype.kill = function () {
        this.killed = true;
    };
    CPU.prototype.continue = function () {
        this.debugging = false;
        this.run();
    };
    CPU.prototype.getNextFewBytes = function () {
        var pc = this.getPC();
        try {
            var b1 = (0, utils_1.toHexString)(this.bus.read(pc, true));
            var b2 = (0, utils_1.toHexString)(this.bus.read(pc + 1, true));
            var b3 = (0, utils_1.toHexString)(this.bus.read(pc + 2, true));
            return "".concat(b1, " ").concat(b2, " ").concat(b3);
        }
        catch (e) {
            return "unable to read the next few bytes at pc ".concat(pc);
        }
    };
    // pc, command
    CPU.prototype.getNextCommands = function () {
        var numCommands = 30;
        var pcOffset = 0;
        var commands = [];
        for (var i = 0; i < numCommands; i++) {
            var instructionNo = this.bus.read(this.getPC() + pcOffset, true);
            var instruction = this.instructions[instructionNo];
            if (!instruction) {
                console.log("unknown instruction ".concat((0, utils_1.toHexString)(instructionNo), " encountered' at address ").concat((0, utils_1.toHexString)(this.getPC() + pcOffset)));
                this.printLastOperations();
                break;
            }
            var param1 = instruction.size > 1 ? " " + (0, utils_1.toHexString)(this.bus.read(this.getPC() + pcOffset + 1, true)) : "";
            var param2 = instruction.size > 2 ? " " + (0, utils_1.toHexString)(this.bus.read(this.getPC() + pcOffset + 2, true)) : "";
            commands.push([this.getPC() + pcOffset, "".concat(instruction.name, " (").concat((0, utils_1.toHexString)(instructionNo)).concat(param1).concat(param2, ")")]);
            pcOffset += instruction.size;
        }
        return commands;
    };
    CPU.prototype.printLastOperations = function () {
        console.log("-----");
        console.log("Last operations:");
        this.lastXOperations.forEach(function (o) { return console.log(o); });
        console.log("-----");
    };
    // only returns the top two element
    CPU.prototype.getStackInfo = function () {
        var sp = this.getSP();
        var result = [];
        result.push(this.bus.read(sp, true));
        result.push(this.bus.read(sp + 1, true));
        return result;
    };
    CPU.prototype.tick = function (tCycles) {
        for (var i = 0; i < tCycles; i++) {
            this.timer.tick();
            this.ppu.tick();
            this.cyclesThisFrame++;
            if (this.tickModulo === 1 || this.tickModulo === 3) {
                this.apu.channel3Tick();
            }
            if (this.tickModulo === 3) {
                // these tick at 4194304 / 4 = 1048576 per second
                this.dma.tick();
                this.apu.tick();
            }
            if (this.serialTickModulo === 511) {
                this.serial.tick();
            }
            // 4194304 / 8192 = 512
            this.serialTickModulo = (this.serialTickModulo + 1) % 512;
            this.tickModulo = (this.tickModulo + 1) % 4;
        }
    };
    // Getters registers
    CPU.prototype.getRegisterA = function () {
        return this.registers.AF & 0xff;
    };
    CPU.prototype.getRegisterB = function () {
        return this.registers.BC & 0xff;
    };
    CPU.prototype.getRegisterC = function () {
        return (this.registers.BC >> 8) & 0xff;
    };
    CPU.prototype.getRegisterD = function () {
        return this.registers.DE & 0xff;
    };
    CPU.prototype.getRegisterE = function () {
        return (this.registers.DE >> 8) & 0xff;
    };
    CPU.prototype.getRegisterF = function () {
        return (this.registers.AF >> 8) & 0xff;
    };
    CPU.prototype.getRegisterH = function () {
        return this.registers.HL & 0xff;
    };
    CPU.prototype.getRegisterL = function () {
        return (this.registers.HL >> 8) & 0xff;
    };
    // Undo the endianess
    CPU.prototype.getRegisterAF = function () {
        return (0, utils_1.toBigEndian)(this.registers.AF);
    };
    CPU.prototype.getRegisterBC = function () {
        return (0, utils_1.toBigEndian)(this.registers.BC);
    };
    CPU.prototype.getRegisterDE = function () {
        return (0, utils_1.toBigEndian)(this.registers.DE);
    };
    CPU.prototype.getRegisterHL = function () {
        return (0, utils_1.toBigEndian)(this.registers.HL);
    };
    CPU.prototype.getRegisterSP = function () {
        return (0, utils_1.toBigEndian)(this.registers.SP);
    };
    CPU.prototype.getRegisterPC = function () {
        return (0, utils_1.toBigEndian)(this.registers.PC);
    };
    // Setters registers
    CPU.prototype.setRegisterA = function (value) {
        this.registers.AF = (this.getRegisterF() << 8) + (value & 0xff);
    };
    CPU.prototype.setRegisterB = function (value) {
        this.registers.BC = (this.getRegisterC() << 8) + (value & 0xff);
    };
    CPU.prototype.setRegisterC = function (value) {
        this.registers.BC = this.getRegisterB() + ((value & 0xff) << 8);
    };
    CPU.prototype.setRegisterD = function (value) {
        this.registers.DE = (this.getRegisterE() << 8) + (value & 0xff);
    };
    CPU.prototype.setRegisterE = function (value) {
        this.registers.DE = this.getRegisterD() + ((value & 0xff) << 8);
    };
    CPU.prototype.setRegisterH = function (value) {
        this.registers.HL = (this.getRegisterL() << 8) + (value & 0xff);
    };
    CPU.prototype.setRegisterL = function (value) {
        this.registers.HL = this.getRegisterH() + ((value & 0xff) << 8);
    };
    CPU.prototype.setRegisterF = function (value) {
        this.registers.AF = ((value & 0xff) << 8) + this.getRegisterA();
    };
    CPU.prototype.setRegisterAF = function (value) {
        this.registers.AF = (0, utils_1.toLittleEndian)(value) & 0xffff;
    };
    CPU.prototype.setRegisterBC = function (value) {
        this.registers.BC = (0, utils_1.toLittleEndian)(value) & 0xffff;
    };
    CPU.prototype.setRegisterDE = function (value) {
        this.registers.DE = (0, utils_1.toLittleEndian)(value) & 0xffff;
    };
    CPU.prototype.setRegisterHL = function (value) {
        this.registers.HL = (0, utils_1.toLittleEndian)(value) & 0xffff;
    };
    CPU.prototype.setRegisterSP = function (value) {
        this.registers.SP = (0, utils_1.toLittleEndian)(value) & 0xffff;
    };
    CPU.prototype.setRegisterPC = function (value) {
        this.registers.PC = (0, utils_1.toLittleEndian)(value) & 0xffff;
    };
    // getters flags
    CPU.prototype.getFlags = function () {
        return this.getRegisterF();
    };
    // bits 7 to 0
    // 7	z	Zero flag
    // 6	n	Subtraction flag (BCD)
    // 5	h	Half Carry flag (BCD)
    // 4	c	Carry flag
    CPU.prototype.getFlagZ = function () {
        return (this.getFlags() >> 7) & 1;
    };
    CPU.prototype.getFlagN = function () {
        return (this.getFlags() >> 6) & 1;
    };
    CPU.prototype.getFlagH = function () {
        return (this.getFlags() >> 5) & 1;
    };
    CPU.prototype.getFlagC = function () {
        return (this.getFlags() >> 4) & 1;
    };
    // setters flags
    CPU.prototype.setFlags = function (value) {
        this.setRegisterF(value);
    };
    CPU.prototype.setFlagZ = function (value) {
        this.setFlags((value << 7) | (this.getFlags() & 127)); // 0b0111_1111 = every bit but the z flag
    };
    CPU.prototype.setFlagN = function (value) {
        this.setFlags((value << 6) | (this.getFlags() & 191)); // every bit but the n flag
    };
    CPU.prototype.setFlagH = function (value) {
        this.setFlags((value << 5) | (this.getFlags() & 223)); // every bit but the h flag
    };
    CPU.prototype.setFlagC = function (value) {
        this.setFlags((value << 4) | (this.getFlags() & 239)); // every bit but the c flag
    };
    CPU.prototype.increasePC = function () {
        this.setRegisterPC((this.getRegisterPC() + 1) & 0xffff);
    };
    CPU.prototype.increaseSP = function () {
        this.setRegisterSP((this.getRegisterSP() + 1) & 0xffff);
    };
    CPU.prototype.decreaseSP = function () {
        this.setRegisterSP((this.getRegisterSP() - 1) & 0xffff);
    };
    CPU.prototype.getPC = function () {
        return this.getRegisterPC();
    };
    CPU.prototype.setPC = function (value) {
        this.setRegisterPC(value);
    };
    CPU.prototype.getSP = function () {
        return this.getRegisterSP();
    };
    CPU.prototype.getRawRegistersForTesting = function () {
        return this.registers;
    };
    CPU.prototype.printRegisters = function () {
        var af = (0, utils_1.toHexString)(this.getRegisterAF(), 16);
        var bc = (0, utils_1.toHexString)(this.getRegisterBC(), 16);
        var de = (0, utils_1.toHexString)(this.getRegisterDE(), 16);
        var hl = (0, utils_1.toHexString)(this.getRegisterHL(), 16);
        var sp = (0, utils_1.toHexString)(this.getRegisterSP(), 16);
        var pc = (0, utils_1.toHexString)(this.getRegisterPC(), 16);
        console.log("Registers: AF: ".concat(af, "\tBC: ").concat(bc, "\tDE: ").concat(de, "\tHL: ").concat(hl, "\tSP: ").concat(sp, "\tPC: ").concat(pc));
    };
    CPU.prototype.printFlags = function () {
        var z = this.getFlagZ();
        var n = this.getFlagN();
        var h = this.getFlagH();
        var c = this.getFlagC();
        console.log("Flags: z: ".concat(z, "\tn: ").concat(n, "\th: ").concat(h, "\tc: ").concat(c));
    };
    return CPU;
}());
exports.CPU = CPU;


/***/ }),

/***/ "./src/gameboy/dma.ts":
/*!****************************!*\
  !*** ./src/gameboy/dma.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DMAImpl = void 0;
var DMAImpl = /** @class */ (function () {
    function DMAImpl(bus, ppu) {
        this.bus = bus;
        this.ppu = ppu;
        this.active = false;
        this.bytesTransferred = 0;
        this.startAddress = 0;
    }
    DMAImpl.prototype.tick = function () {
        if (!this.active) {
            return;
        }
        this.ppu.writeOAM(this.bytesTransferred, this.bus.read(this.startAddress * 0x100 + this.bytesTransferred));
        this.bytesTransferred++;
        if (this.bytesTransferred >= 0xa0) {
            this.active = false;
        }
    };
    DMAImpl.prototype.writeFF46 = function (address) {
        this.bytesTransferred = 0;
        this.active = true;
        this.startAddress = address;
    };
    DMAImpl.prototype.isTransferring = function () {
        return this.active;
    };
    return DMAImpl;
}());
exports.DMAImpl = DMAImpl;


/***/ }),

/***/ "./src/gameboy/gameboy.ts":
/*!********************************!*\
  !*** ./src/gameboy/gameboy.ts ***!
  \********************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Gameboy = void 0;
var apu_1 = __webpack_require__(/*! ./apu */ "./src/gameboy/apu.ts");
var bus_1 = __webpack_require__(/*! ./bus */ "./src/gameboy/bus.ts");
var cart_1 = __webpack_require__(/*! ./cart */ "./src/gameboy/cart.ts");
var cpu_1 = __webpack_require__(/*! ./cpu */ "./src/gameboy/cpu.ts");
var dma_1 = __webpack_require__(/*! ./dma */ "./src/gameboy/dma.ts");
var interrupts_1 = __webpack_require__(/*! ./interrupts */ "./src/gameboy/interrupts.ts");
var joypad_1 = __webpack_require__(/*! ./joypad */ "./src/gameboy/joypad.ts");
var ppu_1 = __webpack_require__(/*! ./ppu */ "./src/gameboy/ppu.ts");
var ram_1 = __webpack_require__(/*! ./ram */ "./src/gameboy/ram.ts");
var serial_1 = __webpack_require__(/*! ./serial */ "./src/gameboy/serial.ts");
var timer_1 = __webpack_require__(/*! ./timer */ "./src/gameboy/timer.ts");
var utils_1 = __webpack_require__(/*! ./utils */ "./src/gameboy/utils.ts");
var Gameboy = /** @class */ (function () {
    function Gameboy() {
        this.idToCartridgeType = {
            0x00: "ROM-ONLY",
            0x01: "MBC1",
            0x02: "MBC1+RAM",
            0x03: "MBC1+RAM+BATTERY",
            0x05: "MBC2",
            0x06: "MBC2+BATTERY",
            0x0f: "MBC3+TIMER+BATTERY",
            0x10: "MBC3+TIMER+RAM+BATTERY",
            0x11: "MBC3",
            0x12: "MBC3+RAM",
            0x13: "MBC3+RAM+BATTERY",
            0x19: "MBC5",
            0x1a: "MBC5+RAM",
            0x1b: "MBC5+RAM+BATTERY",
            0x1c: "MBC5+RUMBLE",
            0x1d: "MBC5+RUMBLE+RAM",
            0x1e: "MBC5+RUMBLE+RAM+BATTERY",
        };
    }
    Gameboy.prototype.load = function (rom) {
        var cartridgeInfo = this.readRomInfo(rom);
        var interrupts = new interrupts_1.InterruptsImpl();
        var cart = (0, cart_1.createCart)(this.cartridgeType, rom, cartridgeInfo);
        var ram = new ram_1.RamImpl();
        // Our canvases
        // main screen
        var screenCanvas = document.getElementById("screen");
        // The full background layer for debugging.
        var backgroundCanvas = document.getElementById("background");
        // Tile canvas, just containing all background tiles for debugging.
        var tileCanvas = document.getElementById("tiles");
        this.ppu = new ppu_1.PPUImpl(screenCanvas, tileCanvas, backgroundCanvas, interrupts);
        var serial = new serial_1.SerialImpl(interrupts);
        var timer = new timer_1.TimerImpl(interrupts);
        this.joypad = new joypad_1.JoyPadImpl(interrupts);
        this.apu = new apu_1.APUImpl();
        this.bus = new bus_1.BusImpl(cart, ram, interrupts, this.ppu, serial, timer, function (startAddress) { return dma.writeFF46(startAddress); }, this.joypad, this.apu);
        var dma = new dma_1.DMAImpl(this.bus, this.ppu);
        this.cpu = new cpu_1.CPU(this.bus, interrupts, this.ppu, this.apu, serial, dma, timer);
        this.cpu.run();
    };
    Gameboy.prototype.startDebug = function () {
        this.cpu.startDebug();
        this.bus.enableDebugLog();
    };
    Gameboy.prototype.getNextCommands = function () {
        return this.cpu.getNextCommands();
    };
    Gameboy.prototype.getStackInfo = function () {
        return this.cpu.getStackInfo();
    };
    Gameboy.prototype.kill = function () {
        var _a;
        // This will stop cpu and can't be resumed. After calling this,
        // you'll need to create a new gameboy instance.
        (_a = this.cpu) === null || _a === void 0 ? void 0 : _a.kill();
    };
    Gameboy.prototype.mute = function () {
        var _a;
        (_a = this.apu) === null || _a === void 0 ? void 0 : _a.mute();
    };
    Gameboy.prototype.unmute = function () {
        var _a;
        (_a = this.apu) === null || _a === void 0 ? void 0 : _a.unmute();
    };
    // register name, register content
    Gameboy.prototype.getRegisterInfo = function () {
        return [
            ["A", (0, utils_1.toHexString)(this.cpu.getRegisterA())],
            ["F", (0, utils_1.toHexString)(this.cpu.getRegisterF())],
            ["B", (0, utils_1.toHexString)(this.cpu.getRegisterB())],
            ["C", (0, utils_1.toHexString)(this.cpu.getRegisterC())],
            ["D", (0, utils_1.toHexString)(this.cpu.getRegisterD())],
            ["E", (0, utils_1.toHexString)(this.cpu.getRegisterE())],
            ["H", (0, utils_1.toHexString)(this.cpu.getRegisterH())],
            ["L", (0, utils_1.toHexString)(this.cpu.getRegisterL())],
            ["SP", (0, utils_1.toHexString)(this.cpu.getRegisterSP())],
            ["PC", (0, utils_1.toHexString)(this.cpu.getRegisterPC())],
        ];
    };
    Gameboy.prototype.getPC = function () {
        return this.cpu.getPC();
    };
    // Flag name, flag content
    Gameboy.prototype.getFlagInfo = function () {
        return [
            ["Z", this.cpu.getFlagZ()],
            ["N", this.cpu.getFlagN()],
            ["H", this.cpu.getFlagH()],
            ["C", this.cpu.getFlagC()],
        ];
    };
    Gameboy.prototype.step = function (count) {
        if (count === void 0) { count = 1; }
        for (var i = 0; i < count; i++) {
            var logStatements = count === 1;
            this.cpu.step(logStatements);
        }
    };
    Gameboy.prototype.continue = function () {
        this.cpu.continue();
        this.bus.disableDebugLog();
    };
    Gameboy.prototype.getCartridgeType = function () {
        var _a;
        return (_a = this.cartridgeType) !== null && _a !== void 0 ? _a : "UNKNOWN";
    };
    Gameboy.prototype.readRomInfo = function (rom) {
        // Cart header goes from $0100—$014F
        // Just the title: 0134-0143 — Title
        var title = "";
        for (var i = 0x134; i < 0x143; i++) {
            title = title + String.fromCharCode(rom[i]);
        }
        var cartrigeType = rom[0x147];
        if (this.idToCartridgeType[cartrigeType] === undefined) {
            throw new Error("Sorry, unsupported cartriged type: " + (0, utils_1.toHexString)(cartrigeType));
        }
        this.cartridgeType = this.idToCartridgeType[cartrigeType];
        console.log("title: ".concat(title, "\tcartridg type: ").concat((0, utils_1.toHexString)(cartrigeType), ", rom size: ").concat(rom.length));
        return {
            title: title,
        };
    };
    Gameboy.prototype.pressStart = function () {
        this.joypad.pressStartButton();
    };
    Gameboy.prototype.releaseStart = function () {
        this.joypad.releaseStartButton();
    };
    Gameboy.prototype.pressSelect = function () {
        this.joypad.pressSelectButton();
    };
    Gameboy.prototype.releaseSelect = function () {
        this.joypad.releaseSelectButton();
    };
    Gameboy.prototype.pressA = function () {
        this.joypad.pressAButton();
    };
    Gameboy.prototype.releaseA = function () {
        this.joypad.releaseAButton();
    };
    Gameboy.prototype.pressB = function () {
        this.joypad.pressBButton();
    };
    Gameboy.prototype.releaseB = function () {
        this.joypad.releaseBButton();
    };
    Gameboy.prototype.pressLeft = function () {
        this.joypad.pressLeft();
    };
    Gameboy.prototype.releaseLeft = function () {
        this.joypad.releaseLeft();
    };
    Gameboy.prototype.pressRight = function () {
        this.joypad.pressRight();
    };
    Gameboy.prototype.releaseRight = function () {
        this.joypad.releaseRight();
    };
    Gameboy.prototype.pressUp = function () {
        this.joypad.pressUp();
    };
    Gameboy.prototype.releaseUp = function () {
        this.joypad.releaseUp();
    };
    Gameboy.prototype.pressDown = function () {
        this.joypad.pressDown();
    };
    Gameboy.prototype.releaseDown = function () {
        this.joypad.releaseDown();
    };
    return Gameboy;
}());
exports.Gameboy = Gameboy;


/***/ }),

/***/ "./src/gameboy/interrupts.ts":
/*!***********************************!*\
  !*** ./src/gameboy/interrupts.ts ***!
  \***********************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.InterruptsImpl = void 0;
var InterruptsImpl = /** @class */ (function () {
    function InterruptsImpl() {
        // IF
        this.interruptFlag = 0x00;
        // enable or disable global interrupt handling
        this.ime = 0;
        // IE interrupt enable, defines what event to listen to
        this.ie = 0;
    }
    InterruptsImpl.prototype.setInterruptFlag = function (value) {
        this.interruptFlag = value & 0xff;
    };
    InterruptsImpl.prototype.getInterruptFlag = function () {
        return this.interruptFlag;
    };
    InterruptsImpl.prototype.setIME = function (value) {
        this.ime = value & 0x1;
    };
    InterruptsImpl.prototype.getIME = function () {
        return this.ime;
    };
    InterruptsImpl.prototype.setIE = function (value) {
        this.ie = value & 0xff;
    };
    InterruptsImpl.prototype.getIE = function () {
        return this.ie;
    };
    InterruptsImpl.prototype.enableInterrupts = function () {
        this.setIME(1);
    };
    InterruptsImpl.prototype.disableInterrupts = function () {
        this.setIME(0);
    };
    InterruptsImpl.prototype.isInterruptsEnabled = function () {
        return this.getIME() === 1;
    };
    return InterruptsImpl;
}());
exports.InterruptsImpl = InterruptsImpl;


/***/ }),

/***/ "./src/gameboy/joypad.ts":
/*!*******************************!*\
  !*** ./src/gameboy/joypad.ts ***!
  \*******************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.JoyPadImpl = void 0;
var JoyPadImpl = /** @class */ (function () {
    function JoyPadImpl(interrupts) {
        this.interrupts = interrupts;
        // 0xFF
        this.JOYP = 0xff;
        this.buttons = 0xf;
        this.pad = 0xf;
    }
    JoyPadImpl.prototype.getJOYP = function () {
        if ((this.JOYP & 0xf0) === 16) {
            return 208 | this.buttons;
        }
        else if ((this.JOYP & 0xf0) === 32) {
            return 224 | this.pad;
        }
        else {
            return 0xff;
        }
    };
    JoyPadImpl.prototype.setJOYP = function (value) {
        this.JOYP = (value & 0xf0) | (this.JOYP & 0x0f);
    };
    JoyPadImpl.prototype.pressStartButton = function () {
        this.buttons = 7;
    };
    JoyPadImpl.prototype.releaseStartButton = function () {
        this.buttons = 0xf;
    };
    JoyPadImpl.prototype.pressSelectButton = function () {
        this.buttons = 11;
    };
    JoyPadImpl.prototype.releaseSelectButton = function () {
        this.buttons = 0xf;
    };
    JoyPadImpl.prototype.pressAButton = function () {
        this.buttons = 14;
    };
    JoyPadImpl.prototype.releaseAButton = function () {
        this.buttons = 0xf;
    };
    JoyPadImpl.prototype.pressBButton = function () {
        this.buttons = 13;
    };
    JoyPadImpl.prototype.releaseBButton = function () {
        this.buttons = 0xf;
    };
    JoyPadImpl.prototype.pressLeft = function () {
        this.pad = this.pad & 13;
        var currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 16);
    };
    JoyPadImpl.prototype.releaseLeft = function () {
        this.pad = this.pad | 2;
        var currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 16);
    };
    JoyPadImpl.prototype.pressRight = function () {
        this.pad = this.pad & 14;
        var currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 16);
    };
    JoyPadImpl.prototype.releaseRight = function () {
        this.pad = this.pad | 1;
        var currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 16);
    };
    JoyPadImpl.prototype.pressUp = function () {
        this.pad = this.pad & 11;
    };
    JoyPadImpl.prototype.releaseUp = function () {
        this.pad = this.pad | 4;
    };
    JoyPadImpl.prototype.pressDown = function () {
        this.pad = this.pad & 7;
    };
    JoyPadImpl.prototype.releaseDown = function () {
        this.pad = this.pad | 8;
    };
    return JoyPadImpl;
}());
exports.JoyPadImpl = JoyPadImpl;


/***/ }),

/***/ "./src/gameboy/lcddebug.ts":
/*!*********************************!*\
  !*** ./src/gameboy/lcddebug.ts ***!
  \*********************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LcdDebugRenderer = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/gameboy/utils.ts");
var lcdutils_1 = __webpack_require__(/*! ./lcdutils */ "./src/gameboy/lcdutils.ts");
var LcdDebugRenderer = /** @class */ (function () {
    function LcdDebugRenderer(tileCanvas, backgroundCanvas, vram, getPPUInfo) {
        this.vram = vram;
        this.getPPUInfo = getPPUInfo;
        // For background debug
        this.currentLineInBackground = 0; // 0 - 255
        this.currentTileInLine = 0; // from 0 - 31
        // In order to avoid overrides we're keeping track of where we put a border.
        this.scrollBorderPositions = [];
        // For tile debug
        this.currentTileInTileView = 0;
        this.currentLineInTile = 0;
        this.colors = [
            [174, 255, 255, 255],
            [21, 205, 214, 255],
            [16, 173, 173, 255],
            [76, 17, 18, 255],
        ];
        this.backgroundCanvasContext = backgroundCanvas.getContext("2d", {
            willReadFrequently: true,
        });
        this.backgroundImageData = this.backgroundCanvasContext.getImageData(0, 0, backgroundCanvas.width, backgroundCanvas.height);
        this.tileViewCanvasContext = tileCanvas.getContext("2d", {
            willReadFrequently: true,
        });
        this.tileViewImageData = this.tileViewCanvasContext.getImageData(0, 0, tileCanvas.width, tileCanvas.height);
        this.backgroundColorPalette = this.getBackgroundColorPalette();
    }
    // We'll render the tiles and the background within
    // the 144 * (80 + 172) dots = 36288 = lines * dots for mode 2 + mode 3.
    // Just so that we don't block too much time for debug rendering.
    // We've got 32*32 = 1024 background tiles picked from a total number
    // of 384 tiles. That gives us approx 36288 / (1024 + 384) = 25 dots per tile.
    // So we can easily render one tile line at a time.
    LcdDebugRenderer.prototype.tick = function () {
        // We're done
        if (this.isBackgroundDone() && this.isTileViewDone()) {
            return;
        }
        if (!this.isBackgroundDone()) {
            this.renderCurrentTileLineForBackgroundView();
            this.currentTileInLine = (this.currentTileInLine + 1) % 32;
            if (this.currentTileInLine === 0) {
                // move one line further
                this.currentLineInBackground++;
            }
            return;
        }
        if (!this.isTileViewDone()) {
            this.renderCurrentTileLineForTileView();
            this.currentLineInTile = (this.currentLineInTile + 1) % 8;
            if (this.currentLineInTile === 0) {
                this.currentTileInTileView++;
            }
        }
    };
    LcdDebugRenderer.prototype.resetForNextFrame = function () {
        // we'll draw what we have before moving on to the next frame
        // for background debug
        this.backgroundCanvasContext.putImageData(this.backgroundImageData, 0, 0);
        this.backgroundColorPalette = this.getBackgroundColorPalette();
        this.currentLineInBackground = 0;
        this.currentTileInLine = 0;
        // for tile debug
        this.tileViewCanvasContext.putImageData(this.tileViewImageData, 0, 0);
        this.currentLineInTile = 0;
        this.currentTileInTileView = 0;
        this.scrollBorderPositions = [];
    };
    LcdDebugRenderer.prototype.getBackgroundColorPalette = function () {
        var bgColorId0 = this.getPPUInfo().BGP_ff47 & 0x03;
        var bgColorId1 = (this.getPPUInfo().BGP_ff47 >> 2) & 0x03;
        var bgColorId2 = (this.getPPUInfo().BGP_ff47 >> 4) & 0x03;
        var bgColorId3 = (this.getPPUInfo().BGP_ff47 >> 6) & 0x03;
        return [bgColorId0, bgColorId1, bgColorId2, bgColorId3];
    };
    LcdDebugRenderer.prototype.renderCurrentTileLineForBackgroundView = function () {
        // data area 0 = 8800–97FF; 1 = 8000–8FFF, keep in mind that 0 points to 0x8000
        var bgMapArea = (this.getPPUInfo().LCDC_ff40 >> 3) & 0x1;
        var tileMapStart = bgMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
        var tileAddressingMode = (this.getPPUInfo().LCDC_ff40 >> 4) & 0x1;
        var tileDataStart = tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;
        // identify the tile number
        // tile map contains tile index (tile maps are 32x32)
        var mapIndex = tileMapStart + Math.floor(this.currentLineInBackground / 8) * 32 + Math.floor(this.currentTileInLine);
        var currentTileIndex = this.vram[mapIndex];
        if (tileAddressingMode === 0) {
            currentTileIndex = (0, utils_1.signedFrom8Bits)(currentTileIndex);
        }
        var currentLineInTile = this.currentLineInBackground % 8;
        var currentTileDataLow = this.vram[tileDataStart + currentTileIndex * 16 + currentLineInTile * 2];
        var currentTileDataHigh = this.vram[tileDataStart + currentTileIndex * 16 + currentLineInTile * 2 + 1];
        for (var i = 7; i >= 0; i--) {
            var color = this.colors[this.backgroundColorPalette[(((currentTileDataHigh >> i) & 0x1) << 1) | ((currentTileDataLow >> i) & 0x1)]];
            var x = this.currentTileInLine * 8 + (7 - i);
            var y = this.currentLineInBackground;
            // Don't draw over the border
            if (!this.scrollBorderPositions[x] || !this.scrollBorderPositions[x][y]) {
                lcdutils_1.LcdUtils.drawPixel(this.backgroundImageData, 256, x, y, color);
            }
        }
    };
    LcdDebugRenderer.prototype.drawScrollBorderPixel = function (x, y) {
        var red = [255, 0, 0, 255];
        lcdutils_1.LcdUtils.drawPixel(this.backgroundImageData, 256, x, y, red);
        lcdutils_1.LcdUtils.drawPixel(this.backgroundImageData, 256, Math.min(255, x + 1), y, red);
        lcdutils_1.LcdUtils.drawPixel(this.backgroundImageData, 256, x, Math.min(255, y + 1), red);
        lcdutils_1.LcdUtils.drawPixel(this.backgroundImageData, 256, Math.min(255, x + 1), Math.min(255, y + 1), red);
        if (this.scrollBorderPositions[x] === undefined) {
            this.scrollBorderPositions[x] = [];
        }
        if (this.scrollBorderPositions[x + 1] === undefined) {
            this.scrollBorderPositions[x + 1] = [];
        }
        this.scrollBorderPositions[x][y] = true;
        // This set impl seems to be too slow, maybe let's replace it
        this.scrollBorderPositions[x + 1][y] = true;
        this.scrollBorderPositions[x][y + 1] = true;
        this.scrollBorderPositions[x + 1][y + 1] = true;
    };
    LcdDebugRenderer.prototype.renderCurrentTileLineForTileView = function () {
        var currentTileDataLow = this.vram[this.currentTileInTileView * 16 + this.currentLineInTile * 2];
        var currentTileDataHigh = this.vram[this.currentTileInTileView * 16 + this.currentLineInTile * 2 + 1];
        for (var i = 7; i >= 0; i--) {
            var color = this.colors[this.backgroundColorPalette[(((currentTileDataHigh >> i) & 0x1) << 1) | ((currentTileDataLow >> i) & 0x1)]];
            var x = Math.floor(this.currentTileInTileView % 16) * 8 + (7 - i);
            var y = Math.floor(this.currentTileInTileView / 16) * 8 + this.currentLineInTile;
            lcdutils_1.LcdUtils.drawPixel(this.tileViewImageData, 128, x, y, color);
        }
    };
    LcdDebugRenderer.prototype.isBackgroundDone = function () {
        // we've got 256 background tiles
        return this.currentLineInBackground > 255;
    };
    LcdDebugRenderer.prototype.isTileViewDone = function () {
        // we've got 384 tiles in the buffer
        return this.currentTileInTileView > 383;
    };
    return LcdDebugRenderer;
}());
exports.LcdDebugRenderer = LcdDebugRenderer;


/***/ }),

/***/ "./src/gameboy/lcdutils.ts":
/*!*********************************!*\
  !*** ./src/gameboy/lcdutils.ts ***!
  \*********************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LcdUtils = void 0;
var LcdUtils = /** @class */ (function () {
    function LcdUtils() {
    }
    LcdUtils.drawPixel = function (canvasData, canvasWidth, x, y, color) {
        var index = (x + y * canvasWidth) * 4;
        canvasData.data[index + 0] = color[0];
        canvasData.data[index + 1] = color[1];
        canvasData.data[index + 2] = color[2];
        canvasData.data[index + 3] = color[3];
    };
    return LcdUtils;
}());
exports.LcdUtils = LcdUtils;


/***/ }),

/***/ "./src/gameboy/ppu.ts":
/*!****************************!*\
  !*** ./src/gameboy/ppu.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PPUImpl = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/gameboy/utils.ts");
var lcddebug_1 = __webpack_require__(/*! ./lcddebug */ "./src/gameboy/lcddebug.ts");
var lcdutils_1 = __webpack_require__(/*! ./lcdutils */ "./src/gameboy/lcdutils.ts");
var SpritePixelFetcher = /** @class */ (function () {
    function SpritePixelFetcher(vram, getPPUInfo) {
        this.vram = vram;
        this.getPPUInfo = getPPUInfo;
        this.spriteFifo = [];
        this.fetchingCompleted = false;
        this.currentTileDataLow = 0x0;
        this.currentTileDataHigh = 0x0;
        this.currentLine = 0;
        // We still keep track of the tile index because for flipped 8x16 tiles we'll have to process the second tile first
        this.currentTileIndex = 0;
        this.steps = [
            { name: "Get tile index", dotCount: 2 },
            { name: "Get tile data low", dotCount: 2 },
            { name: "Get tile data high", dotCount: 2 },
            { name: "Push", dotCount: 1 },
        ];
        // To keep track where we are in the step
        this.currentStepIndex = 0;
        this.currentDotForStep = 0;
    }
    SpritePixelFetcher.prototype.tick = function () {
        var _a;
        if (!this.currentSprite) {
            // We don't do anything if we haven't actually started loading a sprite.
            return;
        }
        var currentStep = this.steps[this.currentStepIndex];
        if (currentStep.name === "Get tile index" && this.currentDotForStep === 0) {
            var flipY = (this.currentSprite.attributes & 64) > 0;
            var tileHeight = ((this.getPPUInfo().LCDC_ff40 >> 2) & 0x1) === 0 ? 8 : 16;
            if (tileHeight === 16) {
                this.currentSprite.tileIndex = this.currentSprite.tileIndex & 254;
            }
            // For flipped 8x16 tiles start off with the second tile
            this.currentTileIndex =
                flipY && tileHeight === 16 ? this.currentSprite.tileIndex + 1 : this.currentSprite.tileIndex;
        }
        else if (currentStep.name === "Get tile data low" && this.currentDotForStep === 0) {
            var flipY = (this.currentSprite.attributes & 64) > 0;
            var lineInTile = this.currentLine - (this.currentSprite.yPosition - 16);
            if (flipY) {
                lineInTile = 7 - lineInTile;
            }
            this.currentTileDataLow = this.vram[this.currentTileIndex * 16 + lineInTile * 2];
        }
        else if (currentStep.name === "Get tile data high" && this.currentDotForStep === 0) {
            var flipY = (this.currentSprite.attributes & 64) > 0;
            var lineInTile = this.currentLine - (this.currentSprite.yPosition - 16);
            if (flipY) {
                lineInTile = 7 - lineInTile;
            }
            this.currentTileDataHigh = this.vram[this.currentTileIndex * 16 + lineInTile * 2 + 1];
        }
        else if (currentStep.name === "Push") {
            var color0 = (((this.currentTileDataHigh >> 7) & 0x1) << 1) | ((this.currentTileDataLow >> 7) & 0x1);
            var color1 = (((this.currentTileDataHigh >> 6) & 0x1) << 1) | ((this.currentTileDataLow >> 6) & 0x1);
            var color2 = (((this.currentTileDataHigh >> 5) & 0x1) << 1) | ((this.currentTileDataLow >> 5) & 0x1);
            var color3 = (((this.currentTileDataHigh >> 4) & 0x1) << 1) | ((this.currentTileDataLow >> 4) & 0x1);
            var color4 = (((this.currentTileDataHigh >> 3) & 0x1) << 1) | ((this.currentTileDataLow >> 3) & 0x1);
            var color5 = (((this.currentTileDataHigh >> 2) & 0x1) << 1) | ((this.currentTileDataLow >> 2) & 0x1);
            var color6 = (((this.currentTileDataHigh >> 1) & 0x1) << 1) | ((this.currentTileDataLow >> 1) & 0x1);
            var color7 = (((this.currentTileDataHigh >> 0) & 0x1) << 1) | ((this.currentTileDataLow >> 0) & 0x1);
            // Palette is 0 or 1
            var palette = (this.currentSprite.attributes >> 4) & 0x1;
            var backgroundPriority = (this.currentSprite.attributes >> 7) & 0x1;
            var tmpPixels = [
                { colorIndex: color0, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color1, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color2, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color3, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color4, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color5, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color6, palette: palette, backgroundPriority: backgroundPriority },
                { colorIndex: color7, palette: palette, backgroundPriority: backgroundPriority },
            ];
            var flipX = (this.currentSprite.attributes & 32) > 0;
            if (flipX) {
                tmpPixels = tmpPixels.reverse();
            }
            // if the sprite is too far on the left, we might have to drop a few pixels
            if (this.currentSprite.xPosition < 8) {
                tmpPixels = tmpPixels.splice(8 - this.currentSprite.xPosition);
            }
            (_a = this.spriteFifo).push.apply(_a, tmpPixels);
            this.fetchingCompleted = true;
        }
        // Move on to next step
        this.currentDotForStep++;
        if (this.currentDotForStep === currentStep.dotCount) {
            this.currentStepIndex++;
            this.currentDotForStep = 0;
        }
    };
    // Don't call this function without checking first that there is a sprite available
    SpritePixelFetcher.prototype.startSpriteFetch = function (xPosition, currentLine) {
        this.spriteFifo.length = 0;
        this.currentLine = currentLine;
        this.fetchingCompleted = false;
        this.currentStepIndex = 0;
        this.currentDotForStep = 0;
        var objectsForLine = this.getPPUInfo().objectsForScanline;
        // Pick the first sprite that matches the x coordinate and remove it from our list
        for (var i = 0; i < objectsForLine.length; i++) {
            if (objectsForLine[i].xPosition - 8 <= xPosition) {
                this.currentSprite = objectsForLine[i];
                // remove the element from the list so that we don't render it again
                objectsForLine.splice(i, 1);
                break;
            }
        }
    };
    SpritePixelFetcher.prototype.getFifo = function () {
        return this.spriteFifo;
    };
    SpritePixelFetcher.prototype.spriteFetchCompleted = function () {
        return this.fetchingCompleted;
    };
    SpritePixelFetcher.prototype.hasSpriteForXIndex = function (xIndex) {
        var objectsForScanline = this.getPPUInfo().objectsForScanline;
        var sprite = objectsForScanline.find(function (o) { return o.xPosition - 8 <= xIndex; });
        return sprite !== undefined;
    };
    return SpritePixelFetcher;
}());
// Great explanation https://hacktix.github.io/GBEDG/ppu/
var BackgroundWindowPixelFetcher = /** @class */ (function () {
    /**
     *
     * @param vram
     */
    function BackgroundWindowPixelFetcher(vram, getPPUInfo) {
        this.vram = vram;
        this.getPPUInfo = getPPUInfo;
        // pixels are only pushed the fifo is empty
        this.backgroundWindowFifo = [];
        this.steps = [
            { name: "Get tile index", dotCount: 2 },
            { name: "Get tile data low", dotCount: 2 },
            { name: "Get tile data high", dotCount: 2 },
            { name: "Sleep", dotCount: 2 },
            { name: "Push", dotCount: 1 }, // I think this needs just a single dot but the fifo has to be empty for it to work
        ];
        // To keep track where we are in the step
        this.currentStepIndex = 0;
        this.currentDotForStep = 0;
        // Y
        this.currentLineIndex = 0;
        // X
        this.currentXIndex = 0;
        // Data we're updating as we fetch
        this.currentTileIndex = 0;
        this.currentLineInTile = 0;
        this.currentTileDataLow = 0x0;
        this.currentTileDataHigh = 0x0;
        this.currentScrollY = 0;
        this.currentScrollX = 0;
        this.currentWindowLine = 0;
        // Once we hit a window coordinate, this flag will get flipped and we'll just render the window from now on.
        this.renderingWindow = false;
        // We need at least 8 elements for object merging at any time
        this.minElementsInBackgroundFifo = 8;
    }
    BackgroundWindowPixelFetcher.prototype.reset = function (toLine, scxAtBeginningOfScanLine) {
        this.backgroundWindowFifo.length = 0;
        this.currentXIndex = 0;
        this.currentScrollX = scxAtBeginningOfScanLine;
        this.currentLineIndex = toLine;
        this.currentStepIndex = 0;
        this.currentDotForStep = 0;
        var isNewFrame = toLine === 0;
        if (isNewFrame) {
            this.currentWindowLine = 0;
        }
        else {
            // For simplicity we assume that we're moving line by line;
            // if we were rendering the window before, we have to got to the next window line
            if (this.renderingWindow) {
                this.currentWindowLine++;
            }
        }
        this.renderingWindow = false;
    };
    // Process:
    // We have to fetch the background tile number (or window tile number if we have already hit the window).
    // Once we entered the window region we empty the buffer and start rendering window pixels until the end.
    // We only push pixels if the buffer is empty. Every tick, one pixel gets consumed, so we usually have to
    // restart the push step twice.
    // This class needs to actively shift pixels out so that it can stop shifting out once we have reached the window
    // Each tile contains 16 bits, 8 bit low followed by 8 bit high
    BackgroundWindowPixelFetcher.prototype.tick = function () {
        var _a;
        var currentStep = this.steps[this.currentStepIndex];
        var pushStepDone = false;
        var tileAddressingMode = (this.getPPUInfo().LCDC_ff40 >> 4) & 0x1;
        var tileDataStart = tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;
        if (currentStep.name === "Get tile index") {
            // Look up tile for window
            if (this.renderingWindow) {
                this.lookupWindowTile(tileAddressingMode);
            }
            else {
                this.lookupBackgroundTile(tileAddressingMode);
            }
            // Check for step name and dot count in every step so that we don't run computations twice.
            // Get Tile Data Next
        }
        else if (currentStep.name === "Get tile data low" && this.currentDotForStep === 0) {
            this.currentTileDataLow = this.vram[tileDataStart + this.currentTileIndex * 16 + this.currentLineInTile * 2];
        }
        else if (currentStep.name === "Get tile data high" && this.currentDotForStep === 0) {
            this.currentTileDataHigh = this.vram[tileDataStart + this.currentTileIndex * 16 + this.currentLineInTile * 2 + 1];
        }
        else if (currentStep.name === "Sleep") {
            // do nothing
        }
        else if (currentStep.name === "Push") {
            var color0 = (((this.currentTileDataHigh >> 7) & 0x1) << 1) | ((this.currentTileDataLow >> 7) & 0x1);
            var color1 = (((this.currentTileDataHigh >> 6) & 0x1) << 1) | ((this.currentTileDataLow >> 6) & 0x1);
            var color2 = (((this.currentTileDataHigh >> 5) & 0x1) << 1) | ((this.currentTileDataLow >> 5) & 0x1);
            var color3 = (((this.currentTileDataHigh >> 4) & 0x1) << 1) | ((this.currentTileDataLow >> 4) & 0x1);
            var color4 = (((this.currentTileDataHigh >> 3) & 0x1) << 1) | ((this.currentTileDataLow >> 3) & 0x1);
            var color5 = (((this.currentTileDataHigh >> 2) & 0x1) << 1) | ((this.currentTileDataLow >> 2) & 0x1);
            var color6 = (((this.currentTileDataHigh >> 1) & 0x1) << 1) | ((this.currentTileDataLow >> 1) & 0x1);
            var color7 = (((this.currentTileDataHigh >> 0) & 0x1) << 1) | ((this.currentTileDataLow >> 0) & 0x1);
            var tmpPixels = [
                { colorIndex: color0 },
                { colorIndex: color1 },
                { colorIndex: color2 },
                { colorIndex: color3 },
                { colorIndex: color4 },
                { colorIndex: color5 },
                { colorIndex: color6 },
                { colorIndex: color7 },
            ];
            if (this.backgroundWindowFifo.length <= this.minElementsInBackgroundFifo) {
                (_a = this.backgroundWindowFifo).push.apply(_a, tmpPixels);
                pushStepDone = true;
                this.currentXIndex = this.currentXIndex + 8;
            }
        }
        // Maybe move on to next step
        this.currentDotForStep++;
        if (this.currentDotForStep === currentStep.dotCount && currentStep.name !== "Push") {
            this.currentStepIndex++;
            this.currentDotForStep = 0;
        }
        else if (currentStep.name === "Push" && pushStepDone) {
            this.currentStepIndex = 0;
            this.currentDotForStep = 0;
        }
    };
    BackgroundWindowPixelFetcher.prototype.lookupWindowTile = function (tileAddressingMode) {
        var windowMapArea = (this.getPPUInfo().LCDC_ff40 >> 6) & 0x1;
        var mapStart = windowMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
        // we're in one of 32x32 tiles
        var pointerToTileIndex = Math.floor(this.currentWindowLine / 8) * 32 + Math.floor(this.currentXIndex / 8);
        this.currentTileIndex = this.vram[mapStart + pointerToTileIndex];
        this.currentLineInTile = this.currentWindowLine % 8;
        if (tileAddressingMode === 0) {
            this.currentTileIndex = (0, utils_1.signedFrom8Bits)(this.currentTileIndex);
        }
    };
    BackgroundWindowPixelFetcher.prototype.lookupBackgroundTile = function (tileAddressingMode) {
        // data area 0 = 8800–97FF; 1 = 8000–8FFF, keep in mind that 0 points to 0x8000
        var bgMapArea = (this.getPPUInfo().LCDC_ff40 >> 3) & 0x1;
        var tileMapStart = bgMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
        // Scrolling is read on tile fetch
        this.currentScrollY = this.getPPUInfo().SCY_ff42;
        // we just started a new line after a reset
        this.currentScrollX = (this.currentScrollX & 7) | (this.getPPUInfo().SCX_ff43 & 248);
        // identify the tile number
        // tile map contains tile index (tile maps are 32x32)
        var mapIndex = tileMapStart +
            Math.floor(((this.currentLineIndex + this.currentScrollY) % 256) / 8) * 32 +
            Math.floor(((this.currentXIndex + this.currentScrollX) % 256) / 8);
        this.currentTileIndex = this.vram[mapIndex];
        if (tileAddressingMode === 0) {
            this.currentTileIndex = (0, utils_1.signedFrom8Bits)(this.currentTileIndex);
        }
        this.currentLineInTile = (this.currentLineIndex + this.currentScrollY) % 8;
    };
    BackgroundWindowPixelFetcher.prototype.getFifo = function () {
        return this.backgroundWindowFifo;
    };
    BackgroundWindowPixelFetcher.prototype.getCurrentScrollX = function () {
        return this.currentScrollX;
    };
    BackgroundWindowPixelFetcher.prototype.isFetchingWindow = function () {
        return this.renderingWindow;
    };
    BackgroundWindowPixelFetcher.prototype.switchToWindowRendering = function () {
        this.renderingWindow = true;
        this.backgroundWindowFifo.length = 0;
        this.currentXIndex = 0;
        this.currentStepIndex = 0;
        this.currentDotForStep = 0;
    };
    return BackgroundWindowPixelFetcher;
}());
var RenderPipeline = /** @class */ (function () {
    /**
     *
     * @param vram
     * @param sendToLCD Called for each pixel, so 160x144 times
     */
    function RenderPipeline(backgroundPixelFetcher, spritePixelFetcher, getPPUInfo, sendToLCD, lcdDebugRenderer) {
        this.backgroundPixelFetcher = backgroundPixelFetcher;
        this.spritePixelFetcher = spritePixelFetcher;
        this.getPPUInfo = getPPUInfo;
        this.sendToLCD = sendToLCD;
        this.lcdDebugRenderer = lcdDebugRenderer;
        // Toy blue
        this.colors = [
            [174, 255, 255, 255],
            [21, 205, 214, 255],
            [16, 173, 173, 255],
            [76, 17, 18, 255],
        ];
        this.pixelsSentToLCDForCurrentLine = 0;
        this.isStartOfScanline = true;
        this.discardPixelsCount = 0;
        this.waitingForSpriteFetch = false;
        this.currentLine = 0;
        // We need at least 8 elements for object merging at any time
        this.minElementsInBackgroundFifo = 8;
    }
    RenderPipeline.prototype.tick = function () {
        // check for objects
        // in the beginning of a line we might have to wait until the background
        // buffer got filled up
        // Not sure if this is the right behaviour but we'll let the buffer fill up first
        // Check if we need to flip to window rendering
        var windowEnabled = ((this.getPPUInfo().LCDC_ff40 >> 5) & 0x1) === 1;
        if (windowEnabled &&
            this.currentLine >= this.getPPUInfo().WY_ff4a &&
            // position is defined as + 7, https://gbdev.io/pandocs/Scrolling.html#ff4aff4b--wy-wx-window-y-position-x-position-plus-7
            this.pixelsSentToLCDForCurrentLine >= this.getPPUInfo().WX_ff4b - 7 &&
            !this.backgroundPixelFetcher.isFetchingWindow()) {
            this.backgroundPixelFetcher.switchToWindowRendering();
        }
        if (this.isStartOfScanline) {
            // The background fetcher reads the scroll x repeatedly
            // but only updates the last 3 bit as part of the first fetch.
            // but only if we're not rendering the window
            if (!this.backgroundPixelFetcher.isFetchingWindow()) {
                this.discardPixelsCount = this.backgroundPixelFetcher.getCurrentScrollX() % 8;
            }
            else if (this.getPPUInfo().WX_ff4b < 7 && this.backgroundPixelFetcher.isFetchingWindow()) {
                // We're fetching the window and the window is slightly moved left off screen
                // so that we have to drop some more pixels.
                this.discardPixelsCount = 7 - this.getPPUInfo().WX_ff4b;
            }
            this.isStartOfScanline = false;
        }
        // Always make sure that we have enough elements in our background buffer
        if (this.backgroundPixelFetcher.getFifo().length < this.minElementsInBackgroundFifo) {
            this.backgroundPixelFetcher.tick();
            if (this.backgroundPixelFetcher.getFifo().length >= this.discardPixelsCount) {
                for (var i = 0; i < this.discardPixelsCount; i++) {
                    this.backgroundPixelFetcher.getFifo().shift();
                    this.discardPixelsCount--;
                }
            }
            return;
        }
        if (this.backgroundPixelFetcher.getFifo().length >= this.minElementsInBackgroundFifo &&
            this.spritePixelFetcher.hasSpriteForXIndex(this.pixelsSentToLCDForCurrentLine) &&
            !this.waitingForSpriteFetch) {
            this.waitingForSpriteFetch = true;
            this.spritePixelFetcher.startSpriteFetch(this.pixelsSentToLCDForCurrentLine, this.currentLine);
        }
        if (this.waitingForSpriteFetch) {
            if (this.spritePixelFetcher.spriteFetchCompleted()) {
                this.waitingForSpriteFetch = false;
                // Merge sprite into background buffer if objects are still enabled
                var objectsEnabled = ((this.getPPUInfo().LCDC_ff40 >> 1) & 0x1) === 1;
                if (objectsEnabled) {
                    this.mergeSpriteIntoBackground();
                }
                // We return early here since there might be another sprite coming
                return;
            }
            else {
                // We need to wait for sprite fetch completion
                this.spritePixelFetcher.tick();
                return;
            }
        }
        // Fetch
        this.backgroundPixelFetcher.tick();
        // Send
        this.maybeSendPixelInFifoToLCD();
    };
    RenderPipeline.prototype.mergeSpriteIntoBackground = function () {
        var spriteFifo = this.spritePixelFetcher.getFifo();
        var backgroundFifo = this.backgroundPixelFetcher.getFifo();
        // if the sprites are one the left side of the screen the sprite fifo might be a bit shorter
        for (var i = 0; i < spriteFifo.length; i++) {
            // 3 conditions:
            // 1. We don't overwrite pixels that have already been overwritten by an earlier sprite
            // 2. We don't overwrite if the sprite pixel is transparent
            // 3. If the sprite priority is 1, then bg/windows colors 1-3 are written over this object
            if (!backgroundFifo[i].overwrittenBySprite &&
                spriteFifo[i].colorIndex > 0 &&
                (spriteFifo[i].backgroundPriority === 0 || backgroundFifo[i].colorIndex === 0)) {
                backgroundFifo[i] = {
                    colorIndex: spriteFifo[i].colorIndex,
                    palette: spriteFifo[i].palette,
                    overwrittenBySprite: true,
                };
            }
        }
    };
    RenderPipeline.prototype.reset = function (toLine, scxAtBeginningOfScanLine) {
        this.currentLine = toLine;
        this.isStartOfScanline = true;
        this.backgroundPixelFetcher.reset(toLine, scxAtBeginningOfScanLine);
    };
    RenderPipeline.prototype.maybeSendPixelInFifoToLCD = function () {
        if (this.backgroundPixelFetcher.getFifo().length <= this.minElementsInBackgroundFifo) {
            // We don't have enough pixels yet
            return;
        }
        if (this.backgroundPixelFetcher.getFifo().length > this.minElementsInBackgroundFifo) {
            var pixel = this.backgroundPixelFetcher.getFifo().shift();
            // discard pixels we don't need
            if (this.discardPixelsCount > 0) {
                this.discardPixelsCount--;
                return;
            }
            var ppuInfo = this.getPPUInfo();
            // if this is a background pixel and the background isn't enabled then we just sent out a white pixel
            if (!(pixel === null || pixel === void 0 ? void 0 : pixel.overwrittenBySprite) && (ppuInfo.LCDC_ff40 & 0x1) === 0) {
                this.sendToLCD(this.colors[0]);
            }
            else if ((pixel === null || pixel === void 0 ? void 0 : pixel.overwrittenBySprite) === true) {
                var obj0ColorId0 = 0; // lower 2 bits ignored for objects, it's transparent for object
                var obj0ColorId1 = (ppuInfo.OBP0_ff48 >> 2) & 0x03;
                var obj0ColorId2 = (ppuInfo.OBP0_ff48 >> 4) & 0x03;
                var obj0ColorId3 = (ppuInfo.OBP0_ff48 >> 6) & 0x03;
                var obj0ColorPalette = [obj0ColorId0, obj0ColorId1, obj0ColorId2, obj0ColorId3];
                var obj1ColorId0 = 0; // lower 2 bits ignored for objects, it's transparent for objects
                var obj1ColorId1 = (ppuInfo.OBP1_ff49 >> 2) & 0x03;
                var obj1ColorId2 = (ppuInfo.OBP1_ff49 >> 4) & 0x03;
                var obj1ColorId3 = (ppuInfo.OBP1_ff49 >> 6) & 0x03;
                var obj1ColorPalette = [obj1ColorId0, obj1ColorId1, obj1ColorId2, obj1ColorId3];
                var objPalette = pixel.palette === 0 ? obj0ColorPalette : obj1ColorPalette;
                this.sendToLCD(this.colors[objPalette[pixel.colorIndex]]);
            }
            else {
                var bgColorId0 = ppuInfo.BGP_ff47 & 0x03;
                var bgColorId1 = (ppuInfo.BGP_ff47 >> 2) & 0x03;
                var bgColorId2 = (ppuInfo.BGP_ff47 >> 4) & 0x03;
                var bgColorId3 = (ppuInfo.BGP_ff47 >> 6) & 0x03;
                var backgroundColorPalette = [bgColorId0, bgColorId1, bgColorId2, bgColorId3];
                this.sendToLCD(this.colors[backgroundColorPalette[pixel.colorIndex]]);
            }
            if (ppuInfo.debugEnabled) {
                this.maybeDrawDebugScrollFrame();
            }
            this.pixelsSentToLCDForCurrentLine = (this.pixelsSentToLCDForCurrentLine + 1) % 160;
        }
    };
    RenderPipeline.prototype.maybeDrawDebugScrollFrame = function () {
        var scrollX = this.getPPUInfo().SCX_ff43;
        var scrollY = this.getPPUInfo().SCY_ff42;
        // Top
        if (this.currentLine === 0) {
            this.lcdDebugRenderer.drawScrollBorderPixel((scrollX + this.pixelsSentToLCDForCurrentLine) % 256, scrollY);
        }
        // Bottom
        if (this.currentLine === 143) {
            this.lcdDebugRenderer.drawScrollBorderPixel((scrollX + this.pixelsSentToLCDForCurrentLine) % 256, (scrollY + 144) % 256);
        }
        // Left and right border
        this.lcdDebugRenderer.drawScrollBorderPixel(scrollX, (this.currentLine + scrollY) % 256);
        this.lcdDebugRenderer.drawScrollBorderPixel((scrollX + 160) % 256, (this.currentLine + scrollY) % 256);
    };
    return RenderPipeline;
}());
/**
 * Simple PPU Impl with a few debugging infos.
 * Known issues:
 * -> tileAddressingMode = (this.LCDC >> 4) & 0x1; for background/window is not updated between lines which breaks layout for some games.
 */
var PPUImpl = /** @class */ (function () {
    function PPUImpl(lcdCanvas, tileCanvas, backgroundCanvas, interrupts) {
        var _this = this;
        this.lcdCanvas = lcdCanvas;
        this.tileCanvas = tileCanvas;
        this.backgroundCanvas = backgroundCanvas;
        this.interrupts = interrupts;
        // VRAM 8000-9FFF, 8192 bytes
        this.vram = [];
        // $FE00-FE9F, OAM, holds 160 bytes of object attributes, 40 entries, 4 bytes each
        this.oam = [];
        // PPU modes, 2 = OAM scan, 3 drawing pixels, 0 hblank, 1 vblank
        this.mode = 2;
        this.objectsForScanline = [];
        // LCDC, can be modified mid scan line
        this.LCDC_ff40 = 0x91;
        // STAT
        this.STAT_ff41 = 0;
        // SCY
        this.SCY_ff42 = 0;
        // SCX
        this.SCX_ff43 = 0;
        // LY read only
        this.LY_ff44 = 0;
        // LYC
        this.LYC_ff45 = 0;
        // BGP BG pallette data
        this.BGP_ff47 = 0;
        // OBP0, lower two bits ignored, color index 0 is transparent
        this.OBP0_ff48 = 0;
        // OBP1, lower two bits ignored, color index 0 is transparent
        this.OBP1_ff49 = 0;
        // We just use this to keep track of the current coordinates on the screen
        // 160x144
        this.x = 0;
        this.y = 0;
        this.allPixelsGeneratedForLine = false;
        // our current dot position
        this.dots = 0;
        // we're keeping track of the penalty in mode 3
        this.penalty = 0;
        // WY
        this.WY_ff4a = 0;
        // WX
        this.WX_ff4b = 0;
        // ppu is enabled on startup
        this.ppuEnabled = true;
        this.isFirstFrameAfterPPUEnabled = false;
        // Let's just keep this running in the background.
        // For slow machines we might want to turn this off.
        this.debugRenderingEnabled = true;
        this.scxAtBeginningOfScanLine = 0x0;
        var getPPUInfoForRenderPipeline = function () { return ({
            LCDC_ff40: _this.LCDC_ff40,
            SCY_ff42: _this.SCY_ff42,
            SCX_ff43: _this.SCX_ff43,
            BGP_ff47: _this.BGP_ff47,
            OBP0_ff48: _this.OBP0_ff48,
            OBP1_ff49: _this.OBP1_ff49,
            WY_ff4a: _this.WY_ff4a,
            WX_ff4b: _this.WX_ff4b,
            objectsForScanline: _this.objectsForScanline,
            debugEnabled: _this.debugRenderingEnabled,
        }); };
        this.debugRenderer = new lcddebug_1.LcdDebugRenderer(tileCanvas, backgroundCanvas, this.vram, getPPUInfoForRenderPipeline);
        var lcdCanvasContext = lcdCanvas.getContext("2d", {
            willReadFrequently: true,
        });
        var lcdCanvasData = lcdCanvasContext.getImageData(0, 0, this.lcdCanvas.width, this.lcdCanvas.height);
        var sendPixelToLCD = function (rgba) {
            // draw
            lcdutils_1.LcdUtils.drawPixel(lcdCanvasData, 160, _this.x, _this.y, rgba);
            // update coords
            _this.x = (_this.x + 1) % 160;
            // new line
            if (_this.x === 0) {
                _this.allPixelsGeneratedForLine = true;
                _this.y = (_this.y + 1) % 144;
                if (_this.y === 0) {
                    // we're done, we can update the buffer on the canvas if this is not the first frame after a recent switch on
                    if (_this.isFirstFrameAfterPPUEnabled) {
                        // do nothing, we should actually render a white frame
                        _this.isFirstFrameAfterPPUEnabled = false;
                    }
                    else {
                        lcdCanvasContext.putImageData(lcdCanvasData, 0, 0);
                    }
                }
            }
        };
        var backgroundWindowPixelFetcher = new BackgroundWindowPixelFetcher(this.vram, getPPUInfoForRenderPipeline);
        var spritePixelFetcher = new SpritePixelFetcher(this.vram, getPPUInfoForRenderPipeline);
        this.renderPipeline = new RenderPipeline(backgroundWindowPixelFetcher, spritePixelFetcher, getPPUInfoForRenderPipeline, sendPixelToLCD, this.debugRenderer);
    }
    PPUImpl.prototype.tick = function () {
        if (!this.ppuEnabled) {
            return;
        }
        // modes changes:
        // mode 2 (oam scan) - mode 3 (drawing) - mode 0 (hblank)
        // mode 1 (vblank)
        if (this.dots === 0 && this.mode !== 1) {
            // mode 2
            this.mode = 2;
            this.scxAtBeginningOfScanLine = this.SCX_ff43;
            // reset scanned objects
            this.objectsForScanline.length = 0;
            // Maybe fire STAT interrupt for mode 2
            if (((this.STAT_ff41 >> 5) & 1) === 1) {
                var currentInterruptFlags = this.interrupts.getInterruptFlag();
                this.interrupts.setInterruptFlag(currentInterruptFlags | 2);
            }
        }
        if (this.dots === 80 && this.mode !== 1) {
            this.renderPipeline.reset(this.LY_ff44, this.SCX_ff43);
            this.mode = 3;
            this.x = 0;
        }
        if (this.allPixelsGeneratedForLine && this.mode !== 1) {
            this.mode = 0;
            this.allPixelsGeneratedForLine = false;
            // Maybe fire STAT interrupt for mode 0
            if (((this.STAT_ff41 >> 3) & 1) === 1) {
                var currentInterruptFlags = this.interrupts.getInterruptFlag();
                this.interrupts.setInterruptFlag(currentInterruptFlags | 2);
            }
        }
        // STAT reg update:
        // update PPU mode
        this.STAT_ff41 = (this.STAT_ff41 & 252) | (this.mode & 3);
        // Check LYC === LY
        if (this.LY_ff44 === this.LYC_ff45) {
            // update stat register and fire interrupt if this hasn't happened already
            if ((this.STAT_ff41 & 4) === 0) {
                this.STAT_ff41 = this.STAT_ff41 | 4;
                // check if we need to fire interrupt
                if (((this.STAT_ff41 >> 6) & 1) === 1) {
                    var currentInterruptFlags = this.interrupts.getInterruptFlag();
                    this.interrupts.setInterruptFlag(currentInterruptFlags | 2);
                }
            }
        }
        else {
            // unset LYC === LC flag in stat
            this.STAT_ff41 = this.STAT_ff41 & 251;
        }
        // Fetch objects if we're in mode 2
        if (this.mode === 2) {
            // this.dots will be between 0 and 79
            // obj ram contains 40 objects
            // we'll check one every other dot
            if (this.dots % 2 === 1) {
                this.scanObject(Math.floor(this.dots / 2));
            }
            // We're ticking our debug renderer during mode 2 and 3
            if (this.debugRenderingEnabled) {
                this.debugRenderer.tick();
            }
        }
        // Render pixel if we're in mode 3
        if (this.mode === 3) {
            this.renderPipeline.tick();
            if (this.debugRenderingEnabled) {
                this.debugRenderer.tick();
            }
        }
        // advance / increase dot
        var dotPerLine = 456;
        var numberOfScanLines = 154;
        this.dots = (this.dots + 1) % dotPerLine;
        if (this.dots === 0) {
            this.LY_ff44 = (this.LY_ff44 + 1) % numberOfScanLines;
            if (this.LY_ff44 === 144) {
                // vblank, mode 1
                this.mode = 1;
                var currentInterruptFlags = this.interrupts.getInterruptFlag();
                this.interrupts.setInterruptFlag(currentInterruptFlags | 0x1);
                // also fire mode 1 STAT interrupt if requested
                if (((this.STAT_ff41 >> 4) & 1) === 1) {
                    var currentInterruptFlags_1 = this.interrupts.getInterruptFlag();
                    this.interrupts.setInterruptFlag(currentInterruptFlags_1 | 2);
                }
            }
            else if (this.LY_ff44 === 0) {
                // we're back at the start
                this.mode = 2;
                this.x = 0;
                this.y = 0;
                this.debugRenderer.resetForNextFrame();
            }
        }
    };
    PPUImpl.prototype.scanObject = function (objectIndex) {
        if (this.objectsForScanline.length < 10) {
            var tileHeight = ((this.LCDC_ff40 >> 2) & 0x1) === 0 ? 8 : 16;
            var oamLocation = objectIndex * 4; // 4 bytes per object
            // first byte is y index which is the only one we'll be checking
            if (this.LY_ff44 >= this.oam[oamLocation] - 16 && this.LY_ff44 < this.oam[oamLocation] - 16 + tileHeight) {
                // we found one
                this.objectsForScanline.push({
                    yPosition: this.oam[oamLocation],
                    xPosition: this.oam[oamLocation + 1],
                    tileIndex: this.oam[oamLocation + 2],
                    attributes: this.oam[oamLocation + 3],
                });
            }
        }
    };
    PPUImpl.prototype.getLCDC = function () {
        return this.LCDC_ff40;
    };
    PPUImpl.prototype.writeFF40 = function (value) {
        var ppuEnabledBeforeUpdate = this.ppuEnabled;
        this.LCDC_ff40 = value & 0xff;
        this.ppuEnabled = ((this.LCDC_ff40 >> 7) & 0x1) === 1;
        // when turning on the screen, it'll stay blank for the first frame
        if (ppuEnabledBeforeUpdate && !this.ppuEnabled) {
            // display switched off
            this.mode = 0;
            this.LY_ff44 = 0;
            this.x = 0;
            this.y = 0;
            this.STAT_ff41 = this.STAT_ff41 & 252;
        }
        else if (!ppuEnabledBeforeUpdate && this.ppuEnabled) {
            this.isFirstFrameAfterPPUEnabled = true;
            // display switched on
            // todo double check if we have to throw LYC interrupt
        }
    };
    PPUImpl.prototype.readFF40 = function () {
        return this.LCDC_ff40;
    };
    PPUImpl.prototype.writeFF41 = function (value) {
        // lower three bit are read only
        var lowerThreeBits = this.STAT_ff41 & 7;
        this.STAT_ff41 = (value & 248) | lowerThreeBits;
    };
    PPUImpl.prototype.readFF41 = function () {
        return (this.STAT_ff41 & 248) | this.mode;
    };
    PPUImpl.prototype.writeFF42 = function (value) {
        this.SCY_ff42 = value & 0xff;
    };
    PPUImpl.prototype.readFF42 = function () {
        return this.SCY_ff42;
    };
    PPUImpl.prototype.writeFF43 = function (value) {
        this.SCX_ff43 = value & 0xff;
    };
    PPUImpl.prototype.readFF43 = function () {
        return this.SCX_ff43;
    };
    PPUImpl.prototype.readFF44 = function () {
        return this.LY_ff44;
    };
    PPUImpl.prototype.writeFF45 = function (value) {
        this.LYC_ff45 = value & 0xff;
    };
    PPUImpl.prototype.readFF45 = function () {
        return this.LYC_ff45;
    };
    PPUImpl.prototype.writeFF47 = function (value) {
        this.BGP_ff47 = value & 0xff;
    };
    PPUImpl.prototype.readFF47 = function () {
        return this.BGP_ff47;
    };
    PPUImpl.prototype.writeFF48 = function (value) {
        this.OBP0_ff48 = value & 0xff;
    };
    PPUImpl.prototype.readFF48 = function () {
        return this.OBP0_ff48;
    };
    PPUImpl.prototype.writeFF49 = function (value) {
        this.OBP1_ff49 = value & 0xff;
    };
    PPUImpl.prototype.readFF49 = function () {
        return this.OBP1_ff49;
    };
    PPUImpl.prototype.writeFF4A = function (value) {
        this.WY_ff4a = value & 0xff;
    };
    PPUImpl.prototype.readFF4A = function () {
        return this.WY_ff4a;
    };
    PPUImpl.prototype.writeFF4B = function (value) {
        this.WX_ff4b = value & 0xff;
    };
    PPUImpl.prototype.readFF4B = function () {
        return this.WX_ff4b;
    };
    PPUImpl.prototype.writeVram = function (address, value) {
        this.vram[address] = value & 0xff;
    };
    PPUImpl.prototype.readVram = function (address) {
        return this.vram[address];
    };
    PPUImpl.prototype.writeOAM = function (address, value) {
        this.oam[address] = value & 0xff;
    };
    PPUImpl.prototype.readOAM = function (address) {
        return this.oam[address];
    };
    PPUImpl.prototype.logDebugInfo = function () {
        this.debugRenderingEnabled = true;
    };
    return PPUImpl;
}());
exports.PPUImpl = PPUImpl;


/***/ }),

/***/ "./src/gameboy/ram.ts":
/*!****************************!*\
  !*** ./src/gameboy/ram.ts ***!
  \****************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RamImpl = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/gameboy/utils.ts");
var RamImpl = /** @class */ (function () {
    function RamImpl() {
        // 0xC000 - 0xDFFF: Working RAM -> 8192 entries, 0 - 8191
        this.workingRam = [];
        // 0xFF80 -	0xFFFE: High ram
        this.highRam = [];
    }
    RamImpl.prototype.readWorkingRam = function (address) {
        var _a;
        if (address > 8191) {
            throw new Error("cannot read from working ram outside of address space" + address);
        }
        return (_a = this.workingRam[address]) !== null && _a !== void 0 ? _a : 0;
    };
    RamImpl.prototype.writeWorkingRam = function (address, value) {
        if (address > 8191) {
            throw new Error("cannot write to working ram outside of address space" + address);
        }
        this.workingRam[address] = value & 0xff;
    };
    RamImpl.prototype.readHighRam = function (address) {
        if (address > 126) {
            throw new Error("cannot read from high ram outside of address space" + address);
        }
        return this.highRam[address];
    };
    RamImpl.prototype.writeHighRam = function (address, value) {
        if (address > 126) {
            throw new Error("cannot write to high ram outside of address space: " + (0, utils_1.toHexString)(address));
        }
        this.highRam[address] = value;
    };
    return RamImpl;
}());
exports.RamImpl = RamImpl;


/***/ }),

/***/ "./src/gameboy/serial.ts":
/*!*******************************!*\
  !*** ./src/gameboy/serial.ts ***!
  \*******************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SerialImpl = void 0;
var SerialImpl = /** @class */ (function () {
    function SerialImpl(interrupts) {
        this.interrupts = interrupts;
        this.SB = 0xff;
        this.SC = 0x00;
        this.dataAsText = "";
        // Just a mock counter thats set to 8 once we want to transfer data
        this.tickCounter = 0;
    }
    SerialImpl.prototype.writeSB = function (value) {
        this.SB = value;
        // this.dataAsText = this.dataAsText + String.fromCharCode(value & 0xff);
        // Use this for debugging serial output
        // console.log('serial output: ' + this.dataAsText);
    };
    SerialImpl.prototype.readSB = function () {
        return this.SB;
    };
    SerialImpl.prototype.writeSC = function (value) {
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
    };
    SerialImpl.prototype.readSC = function () {
        return this.SC;
    };
    SerialImpl.prototype.tick = function () {
        if (this.tickCounter > 0) {
            this.SB = ((this.SB << 1) | 1) & 0xff;
            this.tickCounter--;
            if (this.tickCounter === 0) {
                this.SC = this.SC & 127;
                var currentInterruptFlags = this.interrupts.getInterruptFlag();
                this.interrupts.setInterruptFlag(currentInterruptFlags | 8);
            }
        }
    };
    return SerialImpl;
}());
exports.SerialImpl = SerialImpl;


/***/ }),

/***/ "./src/gameboy/timer.ts":
/*!******************************!*\
  !*** ./src/gameboy/timer.ts ***!
  \******************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.TimerImpl = void 0;
var TimerImpl = /** @class */ (function () {
    function TimerImpl(interrupts) {
        this.interrupts = interrupts;
        // This 8 bit register is incremented at a rate of 16384Hz. This means it's updated every
        // 256 tcycles. Internally, we still have to be able to update our timer values every 4
        // m cycles, so every 16 t cycles. We'll use a small modulo helper to achieve this.
        // FF04
        this.DIV = 0x00;
        this.divModulo = 0;
        // FF05: TIMA TimerCounter
        this.TIMA = 0;
        // FF06: timer modulo, TMA
        this.TMA = 0;
        // FF07: TAC
        this.TAC = 0;
    }
    TimerImpl.prototype.setTimerModulo = function (value) {
        this.TMA = value & 0xff;
    };
    TimerImpl.prototype.setTAC = function (value) {
        this.TAC = value & 0xff;
    };
    TimerImpl.prototype.getTimerDiv = function () {
        return this.DIV;
    };
    TimerImpl.prototype.setTimerCounter = function (value) {
        this.TIMA = value & 0xff;
    };
    TimerImpl.prototype.getTimerCounter = function () {
        return this.TIMA;
    };
    // Called at every t cycle.
    TimerImpl.prototype.tick = function () {
        var updateTimer = false;
        var clockSelect = this.TAC & 3;
        if (clockSelect === 0) {
            // update every 256 m cycles => every 1024 t cycles
            if (this.DIV % 4 === 0 && this.divModulo === 0) {
                updateTimer = true;
            }
        }
        else if (clockSelect === 1) {
            // every 4 m cycles => every 16 tcycles
            if (this.divModulo % 16 === 0) {
                updateTimer = true;
            }
        }
        else if (clockSelect === 2) {
            // every 16 m cycles => every 64 tcycles
            if (this.divModulo % 64 === 0) {
                updateTimer = true;
            }
        }
        else if (clockSelect === 3) {
            // every 64 m cycles => every 256 tcycles
            if (this.divModulo === 255) {
                updateTimer = true;
            }
        }
        var timerEnabled = this.TAC >> 2 === 1;
        if (timerEnabled && updateTimer) {
            this.TIMA = this.TIMA + 1;
            if (this.TIMA > 0xff) {
                this.TIMA = this.TMA;
                // Throw a timer interrupt
                var activeInterrupts = this.interrupts.getInterruptFlag();
                this.interrupts.setInterruptFlag(activeInterrupts | 4);
            }
        }
        // increment our timer
        if (this.divModulo === 255) {
            this.DIV = (this.DIV + 1) & 0xff;
            this.divModulo = 0;
        }
        else {
            this.divModulo++;
        }
    };
    return TimerImpl;
}());
exports.TimerImpl = TimerImpl;


/***/ }),

/***/ "./src/gameboy/utils.ts":
/*!******************************!*\
  !*** ./src/gameboy/utils.ts ***!
  \******************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.toHexString = toHexString;
exports.toLittleEndian = toLittleEndian;
exports.toBigEndian = toBigEndian;
exports.signedFrom8Bits = signedFrom8Bits;
exports.signedFrom11Bits = signedFrom11Bits;
exports.assertExists = assertExists;
function toHexString(n, bits) {
    if (bits === void 0) { bits = 8; }
    var digits = bits / 4; // one character for each nibble
    return "0x" + n.toString(16).padStart(digits, "0").toUpperCase();
}
// The endian conversion functions do pretty much the same but
// I think the names make a bit clearer whats happening.
// Works for 2 bytes only!
function toLittleEndian(bigEndian) {
    var low = bigEndian & 0xff;
    var high = bigEndian & 0xff00;
    return (low << 8) + (high >> 8);
}
// Works for 2 bytes only!
function toBigEndian(littleEndian) {
    var low = littleEndian & 0xff00;
    var high = littleEndian & 0xff;
    return (high << 8) + (low >> 8);
}
function signedFrom8Bits(bits) {
    var isNegative = (bits & 0x80) === 0x80;
    if (isNegative) {
        return -((~bits + 1) & 0xff);
    }
    else {
        return bits;
    }
}
function signedFrom11Bits(bits) {
    var isNegative = bits >> 10 === 0x1;
    if (isNegative) {
        return -((~bits + 1) & 1023);
    }
    else {
        return bits;
    }
}
function assertExists(value, msg) {
    if (value) {
        return value;
    }
    else {
        throw Error(msg);
    }
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it uses a non-standard name for the exports (exports).
(() => {
var exports = __webpack_exports__;
/*!**********************!*\
  !*** ./src/index.ts ***!
  \**********************/

Object.defineProperty(exports, "__esModule", ({ value: true }));
var gameboy_1 = __webpack_require__(/*! ./gameboy/gameboy */ "./src/gameboy/gameboy.ts");
var utils_1 = __webpack_require__(/*! ./gameboy/utils */ "./src/gameboy/utils.ts");
var gameboy;
var isDebugging = false;
var isMuted = false;
var loadRom = function (i) { return function () {
    var _a;
    var file = (0, utils_1.assertExists)((_a = i.files) === null || _a === void 0 ? void 0 : _a.item(0), "No file selected?");
    if (gameboy) {
        gameboy.kill();
    }
    gameboy = new gameboy_1.Gameboy();
    isDebugging = false;
    updateDebugButton();
    file.arrayBuffer().then(function (romData) {
        var romDataUint8 = new Uint8Array(romData);
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.load(romDataUint8);
        var cartridgeType = gameboy === null || gameboy === void 0 ? void 0 : gameboy.getCartridgeType();
        if (cartridgeType && cartrigeTypeOutput) {
            cartrigeTypeOutput.innerHTML = cartridgeType;
        }
        if (isMuted) {
            gameboy === null || gameboy === void 0 ? void 0 : gameboy.mute();
        }
    });
}; };
// Overall layer wrapping all cpu specific outputs.
// Hidden while running.
var cpuDetails = (0, utils_1.assertExists)(document.getElementById("cpuDetails"), "CPU details layer doesn't exist");
var commandOutput = (0, utils_1.assertExists)(document.getElementById("nextCommands"), "Command output doesn't exist");
var registersOutput = (0, utils_1.assertExists)(document.getElementById("registers"), "Registers output doesn't exist");
var flagsOutput = (0, utils_1.assertExists)(document.getElementById("flags"), "Flags output doesn't exist");
var cartrigeTypeOutput = (0, utils_1.assertExists)(document.getElementById("cartridgeType"), "Cartridge type output doesn't exist");
var stackInfoOutput = (0, utils_1.assertExists)(document.getElementById("stackInfo"), "Stack info output doesn't exist");
var debugInfos = (0, utils_1.assertExists)(document.getElementById("debugInfos"), "Debug infos view doesn't exist");
var romFileInput = (0, utils_1.assertExists)(document.getElementById("romFileInput"), "Rom file input doesnt exist");
var muteButton = (0, utils_1.assertExists)(document.getElementById("muteButton"), "Mute button doesnt exists");
var debugButton = (0, utils_1.assertExists)(document.getElementById("debugButton"), "Debug button doesnt exists");
if (romFileInput) {
    romFileInput.onchange = loadRom(romFileInput);
}
var breakpoint = -1;
// Default condition is always true.
// Condition is checked while debugging,
// replace it with something more complex if required.
var condition = function () { return true; };
window.setDebug = function (pc) {
    console.log("setting breakpoint at ".concat(pc));
    breakpoint = pc;
    updateDebugWindows();
};
window.setBreakpoint = function () {
    var _a;
    var breakpointInput = document.getElementById("breakpointInput");
    breakpoint = parseInt((_a = breakpointInput === null || breakpointInput === void 0 ? void 0 : breakpointInput.value) !== null && _a !== void 0 ? _a : "-1");
    updateDebugWindows();
};
window.clearCondition = function () {
    condition = function () { return true; };
};
var updateDebugWindows = function () {
    debugInfos.style.display = "inline";
    var body = document.getElementsByTagName("body")[0];
    body.style.overflow = "auto";
    var commands = gameboy === null || gameboy === void 0 ? void 0 : gameboy.getNextCommands();
    if (commandOutput && commands) {
        commandOutput.innerHTML = commands
            .map(function (c, i) {
            var color = "#FFFFFF";
            if (c[0] === breakpoint) {
                color = "#FF0000";
            }
            else if (i === 0) {
                color = "#AAAAFF";
            }
            return "<div onclick='setDebug(".concat(c[0], ")' style='background-color:").concat(color, "'>").concat((0, utils_1.toHexString)(c[0]), ": ").concat(c[1], "</div>");
        })
            .join("");
    }
    var registers = gameboy === null || gameboy === void 0 ? void 0 : gameboy.getRegisterInfo();
    if (registers) {
        registersOutput.innerHTML = registers.map(function (c) { return "<div>".concat(c[0], ": ").concat(c[1], "</div>"); }).join("");
    }
    var flags = gameboy === null || gameboy === void 0 ? void 0 : gameboy.getFlagInfo();
    if (flags) {
        flagsOutput.innerHTML = flags.map(function (c) { return "<div>".concat(c[0], ": ").concat(c[1], "</div>"); }).join("");
    }
    var stack = gameboy === null || gameboy === void 0 ? void 0 : gameboy.getStackInfo();
    if (stack) {
        stackInfoOutput.innerHTML = stack
            .filter(function (e) { return e !== undefined; })
            .map(function (e) { return "<div>".concat((0, utils_1.toHexString)(e), "</div>"); })
            .join("");
    }
};
var updateDebugButton = function () {
    if (isDebugging) {
        debugButton.innerText = "Resume";
        debugButton.onclick = resume;
    }
    else {
        debugButton.innerText = "Debug";
        debugButton.onclick = debug;
    }
};
var resume = function () {
    isDebugging = false;
    gameboy === null || gameboy === void 0 ? void 0 : gameboy.continue();
    cpuDetails.style.visibility = "hidden";
    updateDebugButton();
};
var debug = function () {
    isDebugging = true;
    cpuDetails.style.visibility = "visible";
    console.log("debugging enabled");
    gameboy === null || gameboy === void 0 ? void 0 : gameboy.startDebug();
    updateDebugWindows();
    updateDebugButton();
};
debugButton.onclick = debug;
// Muting / unmuting
var muteButtonClick = function () {
    if (isMuted) {
        muteButton.innerText = "Mute";
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.unmute();
        isMuted = false;
    }
    else {
        muteButton.innerText = "Unmute";
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.mute();
        isMuted = true;
    }
};
muteButton.onclick = muteButtonClick;
// Keypress handlers
document.addEventListener("keydown", function (e) {
    if (e.key === "d") {
        // Also opens debug controls
        debug();
    }
    else if (e.key === "s" && isDebugging) {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.step();
        updateDebugWindows();
    }
    else if (e.key === "f" && isDebugging) {
        // step x times
        var steps_1 = 1000;
        var i_1 = 0;
        var step_1 = function () {
            gameboy === null || gameboy === void 0 ? void 0 : gameboy.step();
            updateDebugWindows();
            i_1++;
            if (i_1 < steps_1) {
                setTimeout(step_1, 0);
            }
        };
        step_1();
    }
    else if (e.key === "b" && isDebugging) {
        if (breakpoint < 0) {
            alert("Set a breakpoint first");
            return;
        }
        // return if we're already at the breakpoint
        if ((gameboy === null || gameboy === void 0 ? void 0 : gameboy.getPC()) === breakpoint && condition()) {
            return;
        }
        var step_2 = function () {
            // Bit of a hack to speed things up since setTimeout adds too much additional delay.
            for (var i = 0; i < 100000; i++) {
                gameboy === null || gameboy === void 0 ? void 0 : gameboy.step();
                if ((gameboy === null || gameboy === void 0 ? void 0 : gameboy.getPC()) === breakpoint && condition() === true) {
                    updateDebugWindows();
                    return;
                }
            }
            gameboy === null || gameboy === void 0 ? void 0 : gameboy.step();
            updateDebugWindows();
            if ((gameboy === null || gameboy === void 0 ? void 0 : gameboy.getPC()) !== breakpoint || condition() === false) {
                setTimeout(step_2, 0);
            }
        };
        step_2();
    }
    else if (e.key === "c" && isDebugging) {
        resume();
    }
    else if (e.key === "n") {
        console.log("start pressed");
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressStart();
    }
    else if (e.key === "m") {
        console.log("select pressed");
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressSelect();
    }
    else if (e.key === "ArrowLeft") {
        e.preventDefault();
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressLeft();
    }
    else if (e.key === "ArrowRight") {
        e.preventDefault();
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressRight();
    }
    else if (e.key === "ArrowUp") {
        e.preventDefault();
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressUp();
    }
    else if (e.key === "ArrowDown") {
        e.preventDefault();
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressDown();
    }
    else if (e.key === "z") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressA();
    }
    else if (e.key === "x") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.pressB();
    }
    else {
        console.log("unhandled key pressed: " + e.key);
    }
});
document.addEventListener("keyup", function (e) {
    if (e.key === "n") {
        console.log("start released");
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseStart();
    }
    else if (e.key === "m") {
        console.log("select released");
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseSelect();
    }
    else if (e.key === "ArrowLeft") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseLeft();
    }
    else if (e.key === "ArrowRight") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseRight();
    }
    else if (e.key === "ArrowUp") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseUp();
    }
    else if (e.key === "ArrowDown") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseDown();
    }
    else if (e.key === "z") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseA();
    }
    else if (e.key === "x") {
        gameboy === null || gameboy === void 0 ? void 0 : gameboy.releaseB();
    }
});

})();

/******/ })()
;
//# sourceMappingURL=bundle.js.map