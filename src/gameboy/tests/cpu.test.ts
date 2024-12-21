import { APU } from "../apu";
import { Bus } from "../bus";
import { CPU } from "../cpu";
import { DMA } from "../dma";
import { InterruptsImpl } from "../interrupts";
import { PPU } from "../ppu";
import { Timer } from "../timer";
import { signedFrom8Bits } from "../utils";
import { Serial } from "../serial";

describe("cpu", () => {
  const fakeBus: Bus = {
    read: () => 0,
    write: () => {},
    enableDebugLog: () => {},
    disableDebugLog: () => {},
  };

  const fakeTimer: Timer = {
    getTimerDiv: () => 1,
    setTimerModulo: () => {},
    setTimerCounter: () => {},
    getTimerCounter: () => 1,
    tick: () => {},
    setTAC: () => {},
  };

  const fakePPU: PPU = {
    writeFF42: (value: number) => {},
    writeFF43: (value: number) => {},
    readFF42: () => 0,
    readFF43: () => 0,
    writeFF4A: (value: number) => {},
    readFF4A: () => 0,
    writeFF4B: (value: number) => {},
    readFF4B: () => 0,
    writeFF41: (value: number) => {},
    readFF41: () => 0,
    readFF40: () => 0,
    writeFF40: (value: number) => {},
    writeFF47: (value: number) => {},
    readFF47: () => 0,
    writeFF48: (value: number) => {},
    writeFF49: (value: number) => {},
    readFF48: () => 0,
    readFF49: () => 0,
    writeVram: (address: number, value: number) => {},
    readVram: (address: number) => 0,
    writeOAM: (address: number, value: number) => {},
    readOAM: (address: number) => 0,
    readFF44: () => 0,
    writeFF45: () => {},
    readFF45: () => 0,
    tick: () => {},
    logDebugInfo: () => {},
  };

  const fakeDma: DMA = {
    tick: () => {},
    writeFF46: () => {},
    isTransferring: () => false,
  };

  const fakeAPU: APU = {
    writeAudioMasterControl: (value: number) => {},
    readAudioMasterControl: () => 0,

    writeAudioChannelPanning: (value: number) => {},
    readAudioChannelPanning: () => 0,

    writeMasterVolume: (value: number) => {},
    readMasterVolume: () => 0,

    writeChannel1Sweep: (value: number) => {},
    readChannel1Sweep: () => 0,

    writeChannel1LengthAndDuty: (value: number) => {},
    readChannel1Duty: () => 0, // length is write only

    writeChannel1VolumeAndEnvelope: (value: number) => {},
    readChannel1VolumeAndEnvelope: () => 0,

    writeChannel1PeriodLow: (value: number) => {},

    writeChannel1PeriodHighAndControl: (value: number) => {},
    readChannel1LengthEnable: () => 0,

    writeChannel2LengthAndDuty: (value: number) => {},
    readChannel2Duty: () => 0, // length is write only

    writeChannel2VolumeAndEnvelope: (value: number) => {},
    readChannel2VolumeAndEnvelope: () => 0,

    writeChannel2PeriodLow: (value: number) => {},

    writeChannel2PeriodHighAndControl: (value: number) => {},
    readChannel2LengthEnable: () => 0,

    writeChannel3DACOnOff: (value: number) => {},
    readChannel3DACOnOff: () => 0,
    writeChannel3LengthTimer: (value: number) => {},
    writeChannel3OutputLevel: (value: number) => {},
    readChannel3OutputLevel: () => 0,
    writeChannel3PeriodLow: (value: number) => {},
    writeChannel3PeriodHighAndControl: (value: number) => {},
    readChannel3Control: () => 0,
    writeChannel3WavePattern: (address: number, value: number) => {},
    readChannel3WavePattern: (address: number) => 0,

    writeChannel4Length: (value: number) => {},
    writeChannel4VolumeAndEnvelope: (value: number) => {},
    readChannel4VolumeAndEnvelope: () => 0,
    writeChannel4FrequencyAndRandomness: (value: number) => {},
    readChannel4FrequencyAndRandomness: () => 0,
    writeChannel4Control: (value: number) => {},
    readChannel4LengthEnable: () => 0,

    tick: () => {},
    channel3Tick: () => {},

    mute: () => {},
    unmute: () => {},
  };

  const fakeSerial: Serial = {
    writeSB: function (value: number): void {},
    readSB: function (): number {
      return 0;
    },
    writeSC: function (value: number): void {},
    readSC: function (): number {
      return 0;
    },
    tick: function (): void {},
  };

  const interrupts = new InterruptsImpl();

  it("should update the correct flags", () => {
    const cpu = new CPU(fakeBus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setFlags(0x00);
    expect(cpu.getFlags()).toBe(0);
    cpu.setFlagZ(1);
    expect(cpu.getFlags()).toBe(0b1000_0000);

    cpu.setFlagN(1);
    expect(cpu.getFlags()).toBe(0b1100_0000);

    cpu.setFlagZ(0);
    expect(cpu.getFlags()).toBe(0b0100_0000);

    cpu.setFlags(0b1111_0000);
    expect(cpu.getFlags()).toBe(0b1111_0000);

    cpu.setFlagH(0);
    expect(cpu.getFlags()).toBe(0b1101_0000);

    cpu.setFlagC(0);
    expect(cpu.getFlags()).toBe(0b1100_0000);
  });

  it("should set the correct registers", () => {
    const cpu = new CPU(fakeBus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setRegisterAF(0xab_cd);
    expect(cpu.getRegisterAF()).toBe(0xab_cd);
    expect(cpu.getRegisterA()).toBe(0xab);
    expect(cpu.getRegisterF()).toBe(0xcd);
    cpu.setRegisterF(0xff);
    expect(cpu.getRegisterAF()).toBe(0xab_ff);
    cpu.setRegisterA(0x42);
    expect(cpu.getRegisterAF()).toBe(0x42_ff);

    cpu.setRegisterBC(0x65_43);
    expect(cpu.getRegisterB()).toBe(0x65);
    expect(cpu.getRegisterC()).toBe(0x43);
  });

  it("should store values in little endian", () => {
    const cpu = new CPU(fakeBus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setRegisterAF(0xab_cd);
    const rawRegisters = cpu.getRawRegistersForTesting();
    expect(rawRegisters.AF).toBe(0xcd_ab);
  });

  it("should increase the program counter", () => {
    const cpu = new CPU(fakeBus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    expect(cpu.getPC()).toBe(0x0);
    cpu.increasePC();
    expect(cpu.getPC()).toBe(0x1);

    cpu.setPC(0xffff);
    expect(cpu.getPC()).toBe(0xffff);
    cpu.increasePC();
    expect(cpu.getPC()).toBe(0);
    cpu.increasePC();
    expect(cpu.getPC()).toBe(1);
  });

  it("has initialised to the correct registers and flags", () => {
    /* 
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
    const cpu = new CPU(fakeBus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    expect(cpu.getRegisterA()).toBe(0x01);
    expect(cpu.getRegisterF()).toBe(0xb0);
    expect(cpu.getRegisterB()).toBe(0x00);
    expect(cpu.getRegisterC()).toBe(0x13);
    expect(cpu.getRegisterD()).toBe(0x00);
    expect(cpu.getRegisterE()).toBe(0xd8);
    expect(cpu.getRegisterH()).toBe(0x01);
    expect(cpu.getRegisterL()).toBe(0x4d);
    expect(cpu.getRegisterSP()).toBe(0xfffe);
    expect(cpu.getRegisterPC()).toBe(0x0);
  });

  it("should decrement and set the right flags", () => {
    const cpu = new CPU(fakeBus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setFlags(0x0);
    cpu.setRegisterB(3);
    cpu.decB();
    expect(cpu.getRegisterB()).toBe(2);
    // expect only the substract flag to be set
    expect(cpu.getFlags()).toBe(0b0100_0000);

    cpu.setFlags(0x0);
    cpu.setRegisterB(0x10);
    cpu.decB();
    expect(cpu.getRegisterB()).toBe(0x0f);
    // Expect substract and half carry flag to be set
    expect(cpu.getFlags()).toBe(0b0110_0000);

    cpu.decB();
    expect(cpu.getRegisterB()).toBe(0x0e);
    // We don't expect the half carry flag to be set still
    expect(cpu.getFlags()).toBe(0b0100_0000);

    cpu.setRegisterB(0x1);
    cpu.decB();
    expect(cpu.getRegisterB()).toBe(0x00);
    // We expect the zero flag and the substract flag to be set
    expect(cpu.getFlags()).toBe(0b1100_0000);
  });

  it("should DEC B", () => {
    const commands = [0x05, 0x00, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setRegisterB(0x2);
    cpu.setPC(0x0);
    cpu.step();
    expect(cpu.getRegisterB()).toBe(0x01);
    expect(cpu.getFlagN()).toBe(1);
  });

  it("should SWAP - CB 37", () => {
    const commands = [0xcb, 0x37, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setFlags(0xf0);

    cpu.setRegisterA(0xab);
    cpu.step();

    expect(cpu.getRegisterA()).toBe(0xba); // nibbles swapped
    expect(cpu.getFlags()).toBe(0x00);
  });

  it("should RES0 - CB 87", () => {
    const commands = [0xcb, 0x87, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setFlags(0x0);
    cpu.setRegisterA(0x3);
    cpu.step();
    expect(cpu.getRegisterA()).toBe(0x2);
  });

  it("should ADD A, A - 0x87", () => {
    const commands = [0x87, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setFlags(0x00);

    cpu.setRegisterA(0x3);
    cpu.step();

    expect(cpu.getRegisterA()).toBe(0x6);
    expect(cpu.getFlags()).toBe(0x00);
  });

  it("should ADD A, A - 0x87 with half carry", () => {
    const commands = [0x87, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setFlags(0x00);

    cpu.setRegisterA(0x8);
    cpu.step();

    expect(cpu.getRegisterA()).toBe(0x10);
    expect(cpu.getFlagH()).toBe(1);
  });

  it("should ADD HL, DE - 0x19 with half carry", () => {
    const commands = [0x19, 0x00, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setFlags(0x00);

    cpu.setRegisterHL(0x0fff);
    cpu.setRegisterDE(0x1);
    cpu.step();

    expect(cpu.getRegisterHL()).toBe(0x1000);
    expect(cpu.getFlagH()).toBe(1);
    expect(cpu.getFlagC()).toBe(0);
    expect(cpu.getFlagN()).toBe(0);
    expect(cpu.getFlagZ()).toBe(0);
  });

  it("should ADD HL, DE - 0x19 with carry", () => {
    const commands = [0x19, 0x00, 0x00];
    const bus: Bus = {
      read: (address: number) => {
        return commands[address];
      },
      write: (address: number, value: number) => {},
      enableDebugLog: () => {},
      disableDebugLog: () => {},
    };
    const cpu = new CPU(bus, interrupts, fakePPU, fakeAPU, fakeSerial, fakeDma, fakeTimer);
    cpu.setPC(0x00);
    cpu.setFlags(0x00);

    cpu.setRegisterHL(0x3);
    cpu.setRegisterDE(0xffff);
    cpu.step();

    expect(cpu.getRegisterHL()).toBe(0x2);
    expect(cpu.getFlagH()).toBe(1);
    expect(cpu.getFlagC()).toBe(1);
    expect(cpu.getFlagN()).toBe(0);
    expect(cpu.getFlagZ()).toBe(0);
  });

  it("should calculated signed addresses", () => {
    expect(signedFrom8Bits(0b0000_0001)).toBe(1);
    expect(signedFrom8Bits(0b1111_1111)).toBe(-1);
    expect(signedFrom8Bits(0b1000_0000)).toBe(-128);
  });
});
