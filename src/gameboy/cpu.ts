import { APU } from "./apu";
import { Bus } from "./bus";
import { CBOps, GetArg, SetArg } from "./cbops";
import { DMA } from "./dma";
import { Interrupts } from "./interrupts";
import { Serial } from "./serial";
import { PPU } from "./ppu";
import { Timer } from "./timer";
import { signedFrom8Bits, toBigEndian, toHexString, toLittleEndian } from "./utils";

type Instruction = {
  name: string;
  exec: () => void;
  size: number;
};

/**
 * Simple CPU implementation. Initially, I just wrote command by command without using any major abstractions
 * because I wanted to be able to see the full inner workings of a cpu command within one function.
 * However, this became a bit tedious over time so that I used some abstraction on some of the commands,
 * especially the cb ops, which would have otherwise needed a tremendeous amount of code.
 */
export class CPU {
  constructor(
    readonly bus: Bus,
    readonly interrupts: Interrupts,
    readonly ppu: PPU,
    readonly apu: APU,
    readonly serial: Serial,
    readonly dma: DMA,
    private timer: Timer,
  ) {}

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
  private registers = {
    AF: 0xb0_01, // e.g. flags (F) = 0xb0 due to endiness
    BC: 0x13_00,
    DE: 0xd8_00,
    HL: 0x4d_01,
    SP: 0xfe_ff, // 0xFF_FE stack pointer
    PC: 0x00_00, // 0x01_00 = start address
  };

  // For us internally
  private instructionCount = 0;
  // Set to true once we enable debug mode
  private debugging = false;
  // Used this while debugging to see what instructions were used as part of the program execution.
  // These will be printed as soon as you enter debugging mode.
  private usedInstructions: Set<string> = new Set();
  private totalExecutedInstructionCount = 0;
  private maxLastOperations = 30;
  // For debugging purposes, last x operations
  private lastXOperations: string[] = [];

  // We manually killed the cpu, e.g. in case we want to load a new rom.
  // Once killed, there's no way back.
  private killed = false;

  // Triggered by normal halt instruction
  private halted = false;

  // IME, enable interrupts next cycle
  private enableInterruptsOnNextCycle = false;

  // just to keep track of the cycles per frame
  private cyclesThisFrame = 0;

  // Always resets after 4 to translate tcycles to mcycles
  private tickModulo = 0;

  // Modulo to clock the serial connection
  private serialTickModulo = 0;

  private cyclesPerSec = 4194304;
  private cyclesPerFrame = this.cyclesPerSec / 60;
  private timePerFrameMs = 1000 / 60;
  private startTimeMs = performance.now();

  private totalFramesGenerated = 0;
  private absoluteStartTime = 0;

  start() {
    this.totalFramesGenerated = 0;
    this.absoluteStartTime = performance.now();
    this.run();
  }

  run() {
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
    this.totalFramesGenerated++;
    //
    const timeTakenMs = performance.now() - this.startTimeMs;
    setTimeout(
      () => {
        if (!this.killed) {
          this.run();
        }
      },
      // We delay the next frame taking the absolute time taken into account
      // to avoid running out of sync at some point.
      this.absoluteStartTime + this.totalFramesGenerated * this.timePerFrameMs - timeTakenMs - performance.now(),
    );
  }

  step(logStatements = false) {
    if (!this.halted) {
      // just for debugging
      const nextFewBytesString = this.getNextFewBytes();

      // Fetch next instruction
      const pc = this.getPC();

      if (this.recordPcs) {
        this.recordedPcs.push(pc);
      }

      const instructionNo = this.bus.read(pc);
      const instruction = this.instructions[instructionNo];

      // Throw error in case we ran into an instruction that hasn't been implemented yet.
      if (!instruction) {
        console.log(`${this.instructionCount}:----------------`);
        this.printRegisters();
        this.printFlags();
        console.log(`${toHexString(pc, 16)}\t${toHexString(instructionNo)} (${nextFewBytesString})`);

        this.printLastOperations();

        console.log("following instructions were used: ");
        Array.from(this.usedInstructions)
          .sort()
          .forEach((inst, i) => console.log(i + ": " + inst));

        throw Error(`Unknown instruction encountered: ${toHexString(instructionNo)}`);
      }

      try {
        if (this.debugging) {
          console.log(`%cDebugger - executing instruction ${instruction.name}`, "background: #000000; color: #ffffff");
          console.log("Flags and registers before:");
          this.printRegisters();
          this.printFlags();
        }

        let extraInfo = "";
        if (instructionNo === 0xfe) {
          extraInfo = "; d8 = " + toHexString(this.bus.read(this.getPC() + 1));
        }
        if (instructionNo === 0xe9) {
          extraInfo = "; address in HL = " + toHexString(this.getRegisterHL());
        }
        this.lastXOperations.push(
          this.instructionCount +
            " -> pc: " +
            toHexString(pc) +
            ", instr: " +
            instruction.name +
            "(" +
            toHexString(instructionNo) +
            ")" +
            extraInfo,
        );
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
      } catch (e) {
        this.printLastOperations();
        throw e;
      }
    } else {
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
        this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 0b11111110);
      }

      // LCD / stat 0x48
      else if (this.interrupts.getInterruptFlag() & 0b10 && this.interrupts.getIE() & 0b10) {
        this.lastXOperations.push("lcd stat interrupt");
        if (this.lastXOperations.length > this.maxLastOperations) {
          this.lastXOperations.shift();
        }
        this.callInterrupt(0x48);
        this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 0b11111101);
      }

      // Timer / stat 0x50
      else if (this.interrupts.getInterruptFlag() & 0b100 && this.interrupts.getIE() & 0b100) {
        this.lastXOperations.push("timer stat interrupt");
        if (this.lastXOperations.length > this.maxLastOperations) {
          this.lastXOperations.shift();
        }
        this.callInterrupt(0x50);
        this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 0b11111011);
      }

      // Serial 0x58 -- this shouldnt ever get invoked in our impl
      else if (this.interrupts.getInterruptFlag() & 0b1000 && this.interrupts.getIE() & 0b1000) {
        this.lastXOperations.push("serial interrupt");
        if (this.lastXOperations.length > this.maxLastOperations) {
          this.lastXOperations.shift();
        }
        this.callInterrupt(0x58);
        this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 0b11110111);
      }

      // Joypad 0x60
      else if (this.interrupts.getInterruptFlag() & 0b10000 && this.interrupts.getIE() & 0b10000) {
        this.lastXOperations.push("joypad interrupt");
        if (this.lastXOperations.length > this.maxLastOperations) {
          this.lastXOperations.shift();
        }
        this.callInterrupt(0x60);
        this.interrupts.setInterruptFlag(this.interrupts.getInterruptFlag() & 0b11101111);
      }
    }

    if (this.enableInterruptsOnNextCycle) {
      this.enableInterruptsOnNextCycle = false;
      this.interrupts.enableInterrupts();
    }

    if (this.debugging && logStatements) {
      const instructionNo = this.bus.read(this.getPC(), true);
      const instruction = this.instructions[instructionNo];
      console.log(`Debugger - next instruction: ${instruction.name}`);
      console.log(
        `Debugger - next bytes: [${toHexString(this.bus.read(this.getPC(), true))}, ${toHexString(this.bus.read(this.getPC() + 1, true))}, ${toHexString(this.bus.read(this.getPC() + 2, true))}]`,
      );
      console.log("%c-------------------------------------------", "color: #ff0000");
    }

    this.instructionCount++;
  }

  startDebug() {
    this.debugging = true;
    console.log("following instructions were used: ");
    Array.from(this.usedInstructions)
      .sort()
      .forEach((i) => console.log(i));
  }

  kill() {
    this.killed = true;
  }

  continue() {
    this.debugging = false;
    this.start();
  }

  getNextFewBytes(): string {
    const pc = this.getPC();
    try {
      const b1 = toHexString(this.bus.read(pc, true));
      const b2 = toHexString(this.bus.read(pc + 1, true));
      const b3 = toHexString(this.bus.read(pc + 2, true));
      return `${b1} ${b2} ${b3}`;
    } catch (e) {
      return `unable to read the next few bytes at pc ${pc}`;
    }
  }

  // pc, command
  getNextCommands(): [number, string][] {
    const numCommands = 30;
    let pcOffset = 0;
    const commands: [number, string][] = [];
    for (let i = 0; i < numCommands; i++) {
      const instructionNo = this.bus.read(this.getPC() + pcOffset, true);
      const instruction = this.instructions[instructionNo];

      if (!instruction) {
        console.log(
          `unknown instruction ${toHexString(instructionNo)} encountered' at address ${toHexString(this.getPC() + pcOffset)}`,
        );
        this.printLastOperations();
        break;
      }

      const param1 = instruction.size > 1 ? " " + toHexString(this.bus.read(this.getPC() + pcOffset + 1, true)) : "";
      const param2 = instruction.size > 2 ? " " + toHexString(this.bus.read(this.getPC() + pcOffset + 2, true)) : "";

      commands.push([this.getPC() + pcOffset, `${instruction.name} (${toHexString(instructionNo)}${param1}${param2})`]);

      pcOffset += instruction.size;
    }
    return commands;
  }

  printLastOperations() {
    console.log("-----");
    console.log("Last operations:");
    this.lastXOperations.forEach((o) => console.log(o));
    console.log("-----");
  }

  // only returns the top two element
  getStackInfo(): number[] {
    let sp = this.getSP();
    const result: number[] = [];
    result.push(this.bus.read(sp, true));
    result.push(this.bus.read(sp + 1, true));

    return result;
  }

  private tick(tCycles: number) {
    for (let i = 0; i < tCycles; i++) {
      this.timer.tick();
      this.ppu.tick();
      this.cyclesThisFrame++;

      this.apu.tick();

      if (this.tickModulo === 1 || this.tickModulo === 3) {
        this.apu.channel3Tick();
      }

      if (this.tickModulo === 3) {
        // these tick at 4194304 / 4 = 1048576 per second
        this.dma.tick();
      }

      if (this.serialTickModulo === 511) {
        this.serial.tick();
      }

      // 4194304 / 8192 = 512
      this.serialTickModulo = (this.serialTickModulo + 1) % 512;

      this.tickModulo = (this.tickModulo + 1) % 4;
    }
  }

  // Implementations of our cpu instructions

  // 0x00
  private nop = () => {
    this.increasePC();
    this.tick(4);
  };

  // 0x01: LD BC,d16
  private loadImmediate16ToBC = () => {
    this.increasePC();
    this.tick(4);
    // get value
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    const value = (msb << 8) + lsb;
    this.setRegisterBC(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x02 LD (BC), A, writes A into address in BC
  private ldBCAddrA = () => {
    this.increasePC();
    const address = this.getRegisterBC();
    const value = this.getRegisterA();
    this.bus.write(address, value);
    this.tick(8); // accuracy not super important here
  };

  // 0x03 INC BC
  private incBC = () => {
    this.increasePC();
    this.setRegisterBC((this.getRegisterBC() + 1) & 0xffff);
    this.tick(8);
  };

  // 0x04: INC B
  private incB = () => {
    this.increasePC();
    const value = this.getRegisterB();
    const result = (value + 1) & 0xff;

    this.setRegisterB(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x05 DEC B
  // Visible for testing
  decB = () => {
    this.increasePC();
    const r = this.getRegisterB();
    const result = (r - 1) & 0xff;
    this.setRegisterB(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);
    this.tick(4);
  };

  // 0x06: LD B,d8
  private loadImmediate8ToB = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.increasePC();
    this.setRegisterB(value);
    this.tick(4);
  };

  // 0x07: RLCA, rotate
  private rlca = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const cFlag = (a >> 7) & 0x1;
    const result = ((a << 1) & 0xff) | cFlag;
    this.setRegisterA(result);

    this.setFlagC(cFlag);
    this.setFlagZ(0);
    this.setFlagN(0);
    this.setFlagH(0);
    this.tick(4);
  };

  // 0x08: LD (a16),SP
  private lda16SP = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const addressMsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);

    const address = (addressMsb << 8) + addressLsb;

    const sp = this.getSP();
    const spLsb = sp & 0xff;
    const spMsb = (sp >> 8) & 0xff;

    this.bus.write(address, spLsb);
    this.bus.write(address + 1, spMsb);
    this.tick(8);
  };

  // 0x09: ADD HL,BC
  private addHLBC = () => {
    this.addHL(this.getRegisterBC());
  };

  // 0x0A: LD A, (BC)
  private ldABCAddr = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterBC();
    const value = this.bus.read(address);
    this.setRegisterA(value);
    this.tick(4);
  };

  // 0x0B: DEC BC
  private decBC = () => {
    this.increasePC();
    const value = this.getRegisterBC();
    this.setRegisterBC((value - 1) & 0xffff);
    this.tick(8);
  };

  // 0x0C: INC C
  private incC = () => {
    this.increasePC();
    const value = this.getRegisterC();
    const result = (value + 1) & 0xff;

    this.setRegisterC(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x0D DEC C
  private decC = () => {
    this.increasePC();
    const result = (this.getRegisterC() - 1) & 0xff;
    this.setRegisterC(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x0E: LD C,d8
  private loadImmediate8ToC = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.setRegisterC(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x0F: RRCA, rotate
  private rrca = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const cFlag = a & 0x1;
    const result = ((a >> 1) & 0xff) | (cFlag << 7);
    this.setRegisterA(result);

    this.setFlagC(cFlag);
    this.setFlagZ(0);
    this.setFlagN(0);
    this.setFlagH(0);

    this.tick(4);
  };

  // 0x11: LD DE,d16
  private loadImmediate16ToDE = () => {
    this.increasePC();
    this.tick(4);
    // get value
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    const value = (msb << 8) + lsb;
    this.setRegisterDE(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x12 LD (DE), A, writes A into address in DE
  private ldDEAddrA = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterDE();
    const value = this.getRegisterA();
    this.bus.write(address, value);
    this.tick(4);
  };

  // 0x13 INC DE
  private incDE = () => {
    this.increasePC();
    this.setRegisterDE((this.getRegisterDE() + 1) & 0xffff);
    this.tick(8);
  };

  // 0x14: INC D
  private incD = () => {
    this.increasePC();
    const value = this.getRegisterD();
    const result = (value + 1) & 0xff;

    this.setRegisterD(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x15 DEC D
  private decD = () => {
    this.increasePC();
    const result = (this.getRegisterD() - 1) & 0xff;
    this.setRegisterD(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x16: LD D,d8
  private loadImmediate8ToD = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.setRegisterD(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x17: RLA
  private rla = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const cFlag = this.getFlagC();
    const newCFlag = a >> 7 === 0x1 ? 1 : 0;
    const result = (a << 1) | cFlag;
    this.setRegisterA(result);

    this.setFlagC(newCFlag);
    this.setFlagH(0);
    this.setFlagN(0);
    this.setFlagZ(0);

    this.tick(4);
  };

  // 0x18: JR r8
  private jrR8 = () => {
    this.increasePC();
    this.tick(4);
    const relativeAddressUnsigned = this.bus.read(this.getPC());
    this.increasePC(); // not really needed but lets keep it in for completeness reasons
    this.tick(4);
    const relativeAddressSigned = signedFrom8Bits(relativeAddressUnsigned);
    this.setPC(this.getPC() + relativeAddressSigned);
    this.tick(4);
  };

  // 0x19: ADD HL,DE
  private addHLDE = () => {
    this.addHL(this.getRegisterDE());
  };

  // 0x1A: LD A, (DE)
  private ldADEAddr = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterDE();
    const value = this.bus.read(address);
    this.setRegisterA(value);
    this.tick(4);
  };

  // 0x1B: DEC DE
  private decDE = () => {
    this.increasePC();
    const value = this.getRegisterDE();
    this.setRegisterDE((value - 1) & 0xffff);
    this.tick(8);
  };

  // 0x1C INC E
  private incE = () => {
    this.increasePC();
    const value = this.getRegisterE();
    const result = (value + 1) & 0xff;

    this.setRegisterE(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x1D DEC E
  private decE = () => {
    this.increasePC();
    const result = (this.getRegisterE() - 1) & 0xff;
    this.setRegisterE(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x1E: LD E,d8
  private loadImmediate8ToE = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.setRegisterE(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x1F: RRA
  private rra = () => {
    const a = this.getRegisterA();
    this.increasePC();

    const result = (a >> 1) | (this.getFlagC() << 7);
    this.setRegisterA(result);

    this.setFlagZ(0);
    this.setFlagH(0);
    this.setFlagN(0);
    this.setFlagC(a & 0x1);

    this.tick(4);
  };

  // 0x20 JR NZ,r8 => conditional jump tp relative address specified in r
  private jrNzR8 = () => {
    this.increasePC();
    this.tick(4);
    const relativeAddressUnsigned = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const relativeAddressSigned = signedFrom8Bits(relativeAddressUnsigned);
    if (this.getFlagZ() === 0) {
      this.setPC((this.getPC() + relativeAddressSigned) & 0xffff);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0x21: LD HL,d16
  private loadImmediate16ToHL = () => {
    this.increasePC();
    this.tick(4);
    // get value
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const value = (msb << 8) + lsb;
    this.setRegisterHL(value);
  };

  // 0x22: LD (HL+),A => load from accumulator (indirect HL increment)
  private loadFromAccumulatorIndirecHLIncrement = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterHL();
    const data = this.getRegisterA();
    this.bus.write(address, data);
    // HL has to be incremented as part of this operation
    this.setRegisterHL(address + 1);
    this.tick(4);
  };

  // 0x23 INC HL
  private incHL = () => {
    this.increasePC();
    this.setRegisterHL((this.getRegisterHL() + 1) & 0xffff);
    this.tick(8);
  };

  // 0x24: INC H
  private incH = () => {
    this.increasePC();
    const value = this.getRegisterH();
    const result = (value + 1) & 0xff;

    this.setRegisterH(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x25 DEC H
  private decH = () => {
    this.increasePC();
    const result = (this.getRegisterH() - 1) & 0xff;
    this.setRegisterH(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x26: LD H,d8
  private loadImmediate8ToH = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.setRegisterH(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x27: DAA, see https://ehaskins.com/2018-01-30%20Z80%20DAA/
  // for a great explanation of how the DAA instructions works
  private daa = () => {
    this.increasePC();
    let u = 0;
    let cFlag = 0;

    if (this.getFlagH() === 1 || (this.getFlagN() === 0 && (this.getRegisterA() & 0xf) > 9)) {
      u = 6;
    }

    if (this.getFlagC() === 1 || (this.getFlagN() === 0 && this.getRegisterA() > 0x99)) {
      u |= 0x60;
      cFlag = 1;
    }

    const result = this.getFlagN() === 0 ? (this.getRegisterA() + u) & 0xff : (this.getRegisterA() - u) & 0xff;
    this.setRegisterA(result);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagH(0);
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // 0x28: JR Z, r8
  private jrZr8 = () => {
    this.increasePC();
    this.tick(4);
    const relativeAddressUnsigned = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const relativeAddressSigned = signedFrom8Bits(relativeAddressUnsigned);
    if (this.getFlagZ() === 1) {
      this.setPC((this.getPC() + relativeAddressSigned) & 0xffff);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0x29: ADD HL,DE
  private addHLHL = () => {
    this.addHL(this.getRegisterHL());
  };

  // 0x2A: LD A,(HL+), load address in HL to A and increment HL
  private ldAHLPlus = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterHL();
    const value = this.bus.read(address);
    this.setRegisterA(value);
    this.setRegisterHL((address + 1) & 0xffff);
    this.tick(4);
  };

  // 0x2B: DEC HL
  private decHL = () => {
    this.increasePC();
    const value = this.getRegisterHL();
    this.setRegisterHL((value - 1) & 0xffff);
    this.tick(8);
  };

  // 0x2C INC L
  private incL = () => {
    this.increasePC();
    const value = this.getRegisterL();
    const result = (value + 1) & 0xff;

    this.setRegisterL(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x2D: DEC L
  private decL = () => {
    this.increasePC();
    const result = (this.getRegisterL() - 1) & 0xff;
    this.setRegisterL(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x2E: LD L,d8
  private loadImmediate8ToL = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.setRegisterL(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x2F: CPL, flip all bits in register A
  private cpl = () => {
    this.increasePC();
    const value = this.getRegisterA();
    const result = value ^ 0xff;
    this.setRegisterA(result);
    this.setFlagN(1);
    this.setFlagH(1);
    this.tick(4);
  };

  // 0x30 JR NC,r8 => conditional jump tp relative address specified in r
  private jrNCR8 = () => {
    this.increasePC();
    this.tick(4);
    const relativeAddressUnsigned = this.bus.read(this.getPC());
    const relativeAddressSigned = signedFrom8Bits(relativeAddressUnsigned);
    this.increasePC();
    this.tick(4);
    if (this.getFlagC() === 0) {
      this.setPC(this.getPC() + relativeAddressSigned);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0x31: LD SP,d16
  private loadImmediate16ToSP = () => {
    this.increasePC();
    this.tick(4);
    // get value
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    const value = (msb << 8) + lsb;
    this.setRegisterSP(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x32: LD (HL-),A => load from accumulator (indirect HL decrement)
  private loadFromAccumulatorIndirecHLDecrement = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    const data = this.getRegisterA();

    this.bus.write(address, data);
    // HL has to be decremented as part of this operation
    this.setRegisterHL((address - 1) & 0xffff);
    this.tick(8);
  };

  // 0x33 INC SP
  private incSP = () => {
    this.increasePC();
    this.setRegisterSP((this.getRegisterSP() + 1) & 0xffff);
    this.tick(8);
  };

  // 0x34 INC (HL)
  private incHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterHL();
    const value = this.bus.read(address);
    const result = (value + 1) & 0xff;
    this.bus.write(address, result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);
    this.tick(8);
  };

  // 0x35 DEC (HL)
  private decHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getRegisterHL());
    const result = (value - 1) & 0xff;
    this.bus.write(this.getRegisterHL(), result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);
    this.tick(8);
  };

  // 0x36: LD (HL),d8
  private loadImmediateToAddressInHL = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterHL();
    const value = this.bus.read(this.getPC());
    this.increasePC();
    this.bus.write(address, value);
    this.tick(8);
  };

  // 0x37: SCF - set carry flag
  private scf = () => {
    this.increasePC();
    this.setFlagC(1);
    this.setFlagH(0);
    this.setFlagN(0);
    this.tick(4);
  };

  // 0x38: JR C, r8
  private jrCr8 = () => {
    this.increasePC();
    this.tick(4);
    const relativeAddressUnsigned = this.bus.read(this.getPC());
    const relativeAddressSigned = signedFrom8Bits(relativeAddressUnsigned);
    this.increasePC();
    this.tick(4);
    if (this.getFlagC() === 1) {
      this.setPC(this.getPC() + relativeAddressSigned);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0x39: ADD HL,SP
  private addHLSP = () => {
    this.increasePC();
    const hl = this.getRegisterHL();
    const value = this.getRegisterSP();
    const result = (hl + value) & 0xffff;
    this.setRegisterHL(result);

    const hFlag = (hl & 0xfff) + (value & 0xfff) > 0xfff ? 1 : 0;
    const cFlag = hl + value > 0xffff ? 1 : 0;

    this.setFlagN(0);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);
    this.tick(8);
  };

  // 0x3A: LD A,(HL-), load address in HL to A and decrement HL
  private ldAHLMinus = () => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterHL();
    const value = this.bus.read(address);
    this.setRegisterA(value);
    this.setRegisterHL((address - 1) & 0xffff);
    this.tick(4);
  };

  // 0x3B: DEC SP
  private decSP = () => {
    this.increasePC();
    const value = this.getRegisterSP();
    this.setRegisterSP((value - 1) & 0xffff);
    this.tick(8);
  };

  // 0x3C INC A
  private incA = () => {
    this.increasePC();
    const value = this.getRegisterA();
    const result = (value + 1) & 0xff;

    this.setRegisterA(result);

    // Update flags
    this.setFlagN(0);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    const hFlag = (result & 0xf) === 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x3D: DEC A
  private decA = () => {
    this.increasePC();
    const result = (this.getRegisterA() - 1) & 0xff;
    this.setRegisterA(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(1);
    // Set H flag if we've gone from 0x10 to 0x0F
    const hFlag = (result & 0x0f) === 0x0f ? 1 : 0;
    this.setFlagH(hFlag);
    this.tick(4);
  };

  // 0x3E: LD A,d8
  private loadImmediate8ToA = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.setRegisterA(value);
    this.increasePC();
    this.tick(4);
  };

  // 0x3F: CCF - complement carry flag
  private ccf = () => {
    this.increasePC();
    const cFlag = this.getFlagC() === 1 ? 0 : 1;
    this.setFlagC(cFlag);
    this.setFlagH(0);
    this.setFlagN(0);
    this.tick(4);
  };

  // 0x40: LD B,B
  private ldBB = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterB()); // not really needed but lets leave it for completeness
    this.tick(4);
  };

  // 0x41: LD B,C
  private ldBC = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterC());
    this.tick(4);
  };

  // 0x42: LD B,D
  private ldBD = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterD());
    this.tick(4);
  };

  // 0x43: LD B,E
  private ldBE = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterE());
    this.tick(4);
  };

  // 0x44: LD B,H
  private ldBH = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterH());
    this.tick(4);
  };

  // 0x45: LD B,L
  private ldBL = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterL());
    this.tick(4);
  };

  // 0x46: LD CB, (HL)
  private ldBHLAddr = () => {
    this.ldRHL((value) => this.setRegisterB(value));
  };

  // 0x47: LD B,A
  private ldBA = () => {
    this.increasePC();
    this.setRegisterB(this.getRegisterA());
    this.tick(4);
  };

  // 0x48: LD C,B
  private ldCB = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterB());
    this.tick(4);
  };

  // 0x49: LD C,C
  private ldCC = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterC());
    this.tick(4);
  };

  // 0x4A: LD C,D
  private ldCD = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterD());
    this.tick(4);
  };

  // 0x4B: LD C,E
  private ldCE = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterE());
    this.tick(4);
  };

  // 0x4C: LD C,H
  private ldCH = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterH());
    this.tick(4);
  };
  // 0x4D: LD C,L
  private ldCL = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterL());
    this.tick(4);
  };

  // 0x4E: LD C, (HL)
  private ldCHLAddr = () => {
    this.ldRHL((value) => this.setRegisterC(value));
  };

  // 0x4F: LD C,A
  private ldCA = () => {
    this.increasePC();
    this.setRegisterC(this.getRegisterA());
    this.tick(4);
  };

  // 0x50: LD D,B
  private ldDB = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterB()); // not really needed but lets leave it for completeness
    this.tick(4);
  };

  // 0x51: LD D,C
  private ldDC = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterC());
    this.tick(4);
  };

  // 0x52: LD D,D
  private ldDD = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterD());
    this.tick(4);
  };

  // 0x53: LD D,E
  private ldDE = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterE());
    this.tick(4);
  };

  // 0x54: LD D,H
  private ldDH = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterH());
    this.tick(4);
  };

  // 0x55: LD D,L
  private ldDL = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterL());
    this.tick(4);
  };

  // 0x56: LD C, (HL)
  private ldDHLAddr = () => {
    this.ldRHL((value) => this.setRegisterD(value));
  };

  // 0x57: LD D,A
  private ldDA = () => {
    this.increasePC();
    this.setRegisterD(this.getRegisterA());
    this.tick(4);
  };

  // 0x58: LD E,B
  private ldEB = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterB());
    this.tick(4);
  };

  // 0x59: LD E,C
  private ldEC = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterC());
    this.tick(4);
  };

  // 0x5A: LD E,D
  private ldED = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterD());
    this.tick(4);
  };

  // 0x5B: LD E,E
  private ldEE = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterE());
    this.tick(4);
  };

  // 0x5C: LD E,H
  private ldEH = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterH());
    this.tick(4);
  };
  // 0x5D: LD E,L
  private ldEL = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterL());
    this.tick(4);
  };

  // 0x5E: LD E, (HL)
  private ldEHLAddr = () => {
    this.ldRHL((value) => this.setRegisterE(value));
  };

  // 0x5F: LD E,A
  private ldEA = () => {
    this.increasePC();
    this.setRegisterE(this.getRegisterA());
    this.tick(4);
  };

  // 0x60: LD H,B
  private ldHB = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterB()); // not really needed but lets leave it for completeness
    this.tick(4);
  };

  // 0x61: LD H,C
  private ldHC = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterC());
    this.tick(4);
  };

  // 0x62: LD H,D
  private ldHD = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterD());
    this.tick(4);
  };

  // 0x63: LD H,E
  private ldHE = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterE());
    this.tick(4);
  };

  // 0x64: LD H,H
  private ldHH = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterH());
    this.tick(4);
  };

  // 0x65: LD H,L
  private ldHL = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterL());
    this.tick(4);
  };

  // 0x66: LD CB, (HL)
  private ldHHLAddr = () => {
    this.ldRHL((value) => this.setRegisterH(value));
  };

  // 0x67: LD H,A
  private ldHA = () => {
    this.increasePC();
    this.setRegisterH(this.getRegisterA());
    this.tick(4);
  };

  // 0x68: LD L,B
  private ldLB = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterB());
    this.tick(4);
  };

  // 0x69: LD L,C
  private ldLC = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterC());
    this.tick(4);
  };

  // 0x6A: LD L,D
  private ldLD = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterD());
    this.tick(4);
  };

  // 0x6B: LD L,E
  private ldLE = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterE());
    this.tick(4);
  };

  // 0x6C: LD L,H
  private ldLH = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterH());
    this.tick(4);
  };
  // 0x6D: LD L,L
  private ldLL = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterL());
    this.tick(4);
  };

  // 0x6E: LD L, (HL)
  private ldLHLAddr = () => {
    this.ldRHL((value) => this.setRegisterL(value));
  };

  // 0x6F: LD L,A
  private ldLA = () => {
    this.increasePC();
    this.setRegisterL(this.getRegisterA());
    this.tick(4);
  };

  // 0x70: LD (HL), B
  private ldHLAddrB = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterB());
    this.tick(8);
  };

  // 0x71: LD (HL), C
  private ldHLAddrC = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterC());
    this.tick(8);
  };

  // 0x72: LD (HL), D
  private ldHLAddrD = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterD());
    this.tick(8);
  };

  // 0x73: LD (HL), E
  private ldHLAddrE = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterE());
    this.tick(8);
  };

  // 0x74: LD (HL), H
  private ldHLAddrH = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterH());
    this.tick(8);
  };

  // 0x75: LD (HL), L
  private ldHLAddrL = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterL());
    this.tick(8);
  };

  // 0x76: halt
  private halt = () => {
    this.increasePC();
    this.tick(4);

    this.halted = true;
  };

  // 0x77: LD (HL), A
  private ldHLAddrA = () => {
    this.increasePC();
    const address = this.getRegisterHL();
    this.bus.write(address, this.getRegisterA());
    this.tick(8);
  };

  // 0x78: LD A,B
  private ldAB = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterB());
    this.tick(4);
  };

  // 0x79: LD A,C
  private ldAC = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterC());
    this.tick(4);
  };

  // 0x7A: LD A,D
  private ldAD = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterD());
    this.tick(4);
  };

  // 0x7B: LD A,E
  private ldAE = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterE());
    this.tick(4);
  };

  // 0x7C: LD A,H
  private ldAH = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterH());
    this.tick(4);
  };
  // 0x7D: LD A,L
  private ldAL = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterL());
    this.tick(4);
  };

  // 0x7E: LD A, (HL)
  private ldAHLAddr = () => {
    this.ldRHL((value) => this.setRegisterA(value));
  };

  // 0x7F: LD A,A
  private ldAA = () => {
    this.increasePC();
    this.setRegisterA(this.getRegisterA());
    this.tick(4);
  };

  // 0x80: ADD A,B
  private addAB = () => {
    this.add(this.getRegisterB());
  };

  // 0x81: ADD A,C
  private addAC = () => {
    this.add(this.getRegisterC());
  };

  // 0x82: ADD A,D
  private addAD = () => {
    this.add(this.getRegisterD());
  };

  // 0x83: ADD A,E
  private addAE = () => {
    this.add(this.getRegisterE());
  };

  // 0x84: ADD A,H
  private addAH = () => {
    this.add(this.getRegisterH());
  };

  // 0x85: ADD A,L
  private addAL = () => {
    this.add(this.getRegisterL());
  };

  // 0x86: ADD A,(HL)
  private addAHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const v = this.bus.read(this.getRegisterHL());
    const result = (a + v) & 0xff;

    this.setRegisterA(result);
    const zFlag = result === 0 ? 1 : 0;
    const hFlag = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
    const cFlag = a + v > 0xff ? 1 : 0;

    this.setFlagN(0);
    this.setFlagZ(zFlag);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // 0x87: ADD A,A
  private addAA = () => {
    this.add(this.getRegisterA());
  };

  // 0x88: ADC A,B
  private addcAB = () => {
    this.increasePC();
    const value = this.getRegisterB();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);
    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x89: ADC A,C
  private addcAC = () => {
    this.increasePC();
    const value = this.getRegisterC();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x8A: ADC A,D
  private addcAD = () => {
    this.increasePC();
    const value = this.getRegisterD();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x8B: ADC A,E
  private addcAE = () => {
    this.increasePC();
    const value = this.getRegisterE();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x8C: ADC A,H
  private addcAH = () => {
    this.increasePC();
    const value = this.getRegisterH();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x8D: ADC A,L
  private addcAL = () => {
    this.increasePC();
    const value = this.getRegisterL();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x8E: ADC A,(HL)
  private addcAHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getRegisterHL());
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);
    this.tick(4);
  };

  // 0x8F: ADC A,A
  private addcAA = () => {
    this.increasePC();
    const value = this.getRegisterA();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x90: SUB B
  private subB = () => {
    this.sub(this.getRegisterB());
  };

  // 0x91: SUB C
  private subC = () => {
    this.sub(this.getRegisterC());
  };

  // 0x92: SUB D
  private subD = () => {
    this.sub(this.getRegisterD());
  };

  // 0x93: SUB E
  private subE = () => {
    this.sub(this.getRegisterE());
  };

  // 0x94: SUB H
  private subH = () => {
    this.sub(this.getRegisterH());
  };

  // 0x95: SUB L
  private subL = () => {
    this.sub(this.getRegisterL());
  };

  // 0x96: SUB HL
  private subHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const v = this.bus.read(this.getRegisterHL());
    const result = (a - v) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 1;
    const cFlag = a - v < 0 ? 1 : 0;
    const hFlag = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0x97: SUB A
  private subA = () => {
    this.sub(this.getRegisterA());
  };

  // 0x98 SBC A,B
  private sbcAB = () => {
    this.sbc(this.getRegisterB());
  };

  // 0x99 SBC A,C
  private sbcAC = () => {
    this.sbc(this.getRegisterC());
  };

  // 0x9A SBC A,D
  private sbcAD = () => {
    this.sbc(this.getRegisterD());
  };

  // 0x9B SBC A,E
  private sbcAE = () => {
    this.sbc(this.getRegisterE());
  };

  // 0x9C SBC A,H
  private sbcAH = () => {
    this.sbc(this.getRegisterH());
  };

  // 0x9D SBC A,L
  private sbcAL = () => {
    this.sbc(this.getRegisterL());
  };

  // 0x9E SBC A,(HL)
  private sbcAHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const n = this.bus.read(this.getRegisterHL());
    const carry = this.getFlagC();

    const result = (a - n - carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 1;
    const hFlag = (a & 0xf) - (n & 0xf) - carry < 0 ? 1 : 0;
    const cFlag = (a & 0xff) - (n & 0xff) - carry < 0 ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // 0x9F SBC A,A
  private sbcAA = () => {
    this.sbc(this.getRegisterA());
  };

  // 0xA0: AND B
  private andB = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterB();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA1: AND C
  private andC = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterC();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA2: AND D
  private andD = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterD();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA3: AND E
  private andE = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterE();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA4: AND H
  private andH = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterH();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA5: AND L
  private andL = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterL();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA6: AND (HL)
  private andHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const r = this.bus.read(this.getRegisterHL());
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);
    this.tick(4);
  };

  // 0xA7: AND A
  private andA = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterA();
    const result = a & r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlagValue = result === 0 ? 1 : 0;
    this.setFlagZ(zFlagValue);
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xA8: XOR B
  private xorRegisterB = () => {
    const a = this.getRegisterA();
    const r = this.getRegisterB();
    const result = a ^ r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xA9: XOR C
  private xorRegisterC = () => {
    const a = this.getRegisterA();
    const r = this.getRegisterC();
    const result = (a ^ r) & 0xff;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xAA: XOR D
  private xorRegisterD = () => {
    const a = this.getRegisterA();
    const r = this.getRegisterD();
    const result = (a ^ r) & 0xff;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xAB: XOR E
  private xorRegisterE = () => {
    const a = this.getRegisterA();
    const r = this.getRegisterE();
    const result = a ^ r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xAC: XOR H
  private xorRegisterH = () => {
    const a = this.getRegisterA();
    const r = this.getRegisterH();
    const result = a ^ r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xAD: XOR L
  private xorRegisterL = () => {
    const a = this.getRegisterA();
    const r = this.getRegisterL();
    const result = a ^ r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xAE: XOR (HL)
  private xorHLAddr = () => {
    this.increasePC();
    const a = this.getRegisterA();
    this.tick(4);
    const r = this.bus.read(this.getRegisterHL());
    const result = a ^ r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);

    this.tick(4);
  };

  // 0xAF: XOR A
  private xorRegisterA = () => {
    const a = this.getRegisterA();
    const result = (a ^ a) & 0xff;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.increasePC();

    this.tick(4);
  };

  // 0xB0: OR B
  private orB = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterB();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xB1: OR C
  private orC = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterC();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xB2: OR D
  private orD = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterD();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };
  // 0xB3: OR E
  private orE = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterE();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };
  // 0xB4: OR H
  private orH = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterH();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };
  // 0xB5: OR L
  private orL = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterL();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xB6: OR (HL)
  private orHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const r = this.bus.read(this.getRegisterHL());
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xB7: OR A
  private orA = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterA();
    const result = a | r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagH(0);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xB8: CP B (Compare B)
  private cpB = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterB();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xB9: CP C (Compare C)
  private cpC = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterC();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xBA: CP D (Compare D)
  private cpD = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterD();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xBB: CP E (Compare E)
  private cpE = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterE();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xBC: CP H (Compare H)
  private cpH = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterH();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xBD: CP L (Compare L)
  private cpL = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterL();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xBE: CP (HL) (Compare (HL))
  private cpHLAddr = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const r = this.bus.read(this.getRegisterHL());
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xBF: CP A (Compare A)
  private cpA = () => {
    this.increasePC();
    const a = this.getRegisterA();
    const r = this.getRegisterA();
    const zFlag = a - r === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(1);
    const cFlag = a - r < 0 ? 1 : 0;
    this.setFlagC(cFlag);
    const hFlag = (a & 0x0f) - (r & 0x0f) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // 0xC0: RET NZ
  private retNZ = () => {
    this.increasePC();
    this.tick(8);
    if (this.getFlagZ() === 0) {
      const addressLsb = this.bus.read(this.getSP());
      this.increaseSP();
      const addressMsb = this.bus.read(this.getSP());
      this.increaseSP();

      const address = (addressMsb << 8) + addressLsb;

      this.setPC(address);
      this.tick(12);
      return true;
    } else {
      return false;
    }
  };

  // 0xC1: POP BC
  private popBC = () => {
    this.increasePC();
    this.tick(4);
    const dataLsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const dataMsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const data = (dataMsb << 8) + dataLsb;
    this.setRegisterBC(data);
  };

  // 0xC2: JP NZ,a16
  private jpNZa16 = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const addressMsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (addressMsb << 8) + addressLsb;
    if (this.getFlagZ() === 0) {
      this.setPC(address);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0xC3: JP a16, unconditional jump to 16bit address
  private jpUnconditional = () => {
    const pc = this.getPC();
    this.increasePC();
    this.tick(4);
    // get address
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (msb << 8) + lsb;

    this.setPC(address);
    this.tick(4);
  };

  // 0xC4: CALL NZ, a16
  private callNZa16 = () => {
    this.increasePC();
    this.tick(4);
    // get address
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (msb << 8) + lsb;
    if (this.getFlagZ() === 0) {
      // back up current address and jump to location
      const currentPC = this.getPC();
      const pcLsb = currentPC & 0xff;
      const pcMsb = (currentPC >> 8) & 0xff;

      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcMsb);
      this.tick(4);
      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcLsb);
      this.tick(4);
      this.setPC(address);
      this.tick(4);
      return true;
    }
    return false;
  };

  // 0xC5: PUSH BC
  private pushBC = () => {
    this.push16(this.getRegisterBC());
  };

  // 0xC6 ADD A,d8
  private addAd8 = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const v = this.bus.read(this.getPC());
    this.increasePC();

    const result = (a + v) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const hFlag = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
    const cFlag = a + v > 0xff ? 1 : 0;

    this.setFlagN(0);
    this.setFlagZ(zFlag);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // 0xC7 RST 00H - restart to absolute fixed address
  private rst00H = () => {
    this.increasePC();
    this.tick(4);
    const address = 0x00;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.tick(4);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.tick(4);
    this.setPC(address);
    this.tick(4);
  };

  // 0xC8: RETZ, conditional return
  private retZ = () => {
    this.increasePC();
    this.tick(8);
    if (this.getFlagZ() === 1) {
      const addressLsb = this.bus.read(this.getSP());
      this.tick(4);
      this.increaseSP();
      const addressMsb = this.bus.read(this.getSP());
      this.tick(4);
      this.increaseSP();

      const address = (addressMsb << 8) + addressLsb;
      this.tick(4);

      this.setPC(address);
      return true;
    } else {
      return false;
    }
  };

  // 0xC9: RET, unconditional return
  private ret = () => {
    this.increasePC(); // not really needed but added for completeness
    this.tick(4);
    const addressLsb = this.bus.read(this.getSP());
    this.tick(4);
    this.increaseSP();
    const addressMsb = this.bus.read(this.getSP());
    this.tick(4);
    this.increaseSP();

    const address = (addressMsb << 8) + addressLsb;

    this.setPC(address);
    this.tick(4);
  };

  // 0xCA: JP Z, a16
  private jpZa16 = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const addressMsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);

    const address = (addressMsb << 8) + addressLsb;

    if (this.getFlagZ() === 1) {
      this.setPC(address);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0xCB - Prefix ops
  private cb = () => {
    const operands: [GetArg, SetArg][] = [
      [() => this.getRegisterB(), (value: number) => this.setRegisterB(value)],
      [() => this.getRegisterC(), (value: number) => this.setRegisterC(value)],
      [() => this.getRegisterD(), (value: number) => this.setRegisterD(value)],
      [() => this.getRegisterE(), (value: number) => this.setRegisterE(value)],
      [() => this.getRegisterH(), (value: number) => this.setRegisterH(value)],
      [() => this.getRegisterL(), (value: number) => this.setRegisterL(value)],
      [() => this.bus.read(this.getRegisterHL()), (value: number) => this.bus.write(this.getRegisterHL(), value)],
      [() => this.getRegisterA(), (value: number) => this.setRegisterA(value)],
    ];

    this.increasePC();
    const operation = this.bus.read(this.getPC());
    this.increasePC();

    const cbRow = operation >> 4;
    // left side of operations table = 0, right side = 1
    const side = (operation & 0x0f) > 7 ? 1 : 0;
    const operand = (operation & 0x0f) % 0x8;

    let cycles = 0;
    const operationExec = CBOps.opsTable[cbRow][side];
    if (operationExec) {
      cycles = operationExec(operands[operand][0], operands[operand][1], this);
      this.tick(cycles);

      // special ops with 12 ticks
      const twelveTickOperations = [0x46, 0x56, 0x66, 0x76, 0x4e, 0x5e, 0x6e, 0x7e];

      // extra cycles for (HL) operations
      if (
        ((operation & 0xf) === 0x6 || (operation & 0xf) === 0xe) &&
        twelveTickOperations.includes(operation) === false
      ) {
        // it's always 8 extra ticks for these
        this.tick(8);
      } else if (
        ((operation & 0xf) === 0x6 || (operation & 0xf) === 0xe) &&
        twelveTickOperations.includes(operation) === true
      ) {
        this.tick(4);
      }
    } else {
      throw new Error(`cb operation ${toHexString(operation)} not implemented`);
    }

    return cycles;
  };

  // 0xCC: CALL Z,a16
  private callZa16 = () => {
    this.increasePC();
    this.tick(4);
    // get address
    const lsb = this.bus.read(this.getPC());
    this.tick(4);
    this.increasePC();
    const msb = this.bus.read(this.getPC());
    this.tick(4);
    this.increasePC();
    const address = (msb << 8) + lsb;
    if (this.getFlagZ() === 1) {
      // back up current address and jump to location
      const currentPC = this.getPC();
      this.tick(4);
      const pcLsb = currentPC & 0xff;
      const pcMsb = (currentPC >> 8) & 0xff;

      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcMsb);
      this.tick(4);
      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcLsb);
      this.tick(4);
      this.setPC(address);
      return true;
    }
    return false;
  };

  // 0xCD: CALL a16, unconditional call of 16 bit address
  private calla16 = () => {
    this.increasePC();
    this.tick(4);
    const addrLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const addrMsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (addrMsb << 8) + addrLsb;

    // Store PC to the stack
    const currentPC = this.getPC();
    const pcLsb = currentPC & 0xff;
    const pcMsb = (currentPC >> 8) & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.tick(4);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.tick(4);
    this.setPC(address);
    this.tick(4);
  };

  // 0xCE: ADC A, d8
  private addcAD8 = () => {
    this.increasePC();
    this.tick(4);
    const value = this.bus.read(this.getPC());
    this.increasePC();
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const result = (a + value + carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 0;
    const cFlag = a + value + carry > 0xff ? 1 : 0;
    const hFlag = (a & 0xf) + (value & 0xf) + carry > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);
    this.tick(4);
  };

  // 0xCF RST 08H - restart to absolute fixed address
  private rst08H = () => {
    this.increasePC();
    const address = 0x08;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xD0: RET NC
  private retNC = () => {
    this.increasePC();
    this.tick(8);

    if (this.getFlagC() === 0) {
      const addressLsb = this.bus.read(this.getSP());
      this.tick(4);
      this.increaseSP();
      const addressMsb = this.bus.read(this.getSP());
      this.tick(4);
      this.increaseSP();

      const address = (addressMsb << 8) + addressLsb;

      this.setPC(address);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0xD1: POP DE
  private popDE = () => {
    this.increasePC();
    this.tick(4);
    const dataLsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const dataMsb = this.bus.read(this.getSP());
    this.increaseSP();

    const data = (dataMsb << 8) + dataLsb;
    this.setRegisterDE(data);
    this.tick(4);
  };

  push16 = (value: number) => {
    this.increasePC();
    const valueLsb = value & 0xff;
    const valueMsb = (value >> 8) & 0xff;
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), valueMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), valueLsb);

    this.tick(16);
  };

  // 0xD2: JP NC,a16
  private jpNCa16 = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const addressMsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);

    const address = (addressMsb << 8) + addressLsb;
    if (this.getFlagC() === 0) {
      this.setPC(address);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0xD4: CALL NC, a16
  private callNCa16 = () => {
    this.increasePC();
    this.tick(4);
    // get address
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (msb << 8) + lsb;
    if (this.getFlagC() === 0) {
      // back up current address and jump to location
      const currentPC = this.getPC();
      const pcLsb = currentPC & 0xff;
      const pcMsb = (currentPC >> 8) & 0xff;

      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcMsb);
      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcLsb);
      this.setPC(address);
      this.tick(12);
      return true;
    }
    return false;
  };

  // 0xD5: PUSH DE
  private pushDE = () => {
    this.push16(this.getRegisterDE());
  };

  // 0xD6: SUB d8
  private subD8 = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const v = this.bus.read(this.getPC());
    this.increasePC();
    const result = (a - v) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 1;
    const cFlag = a - v < 0 ? 1 : 0;
    const hFlag = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);
    this.tick(4);
  };

  // 0xD7 RST 10H - restart to absolute fixed address
  private rst10H = () => {
    this.increasePC();
    const address = 0x10;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xD8 RET C
  private retC = () => {
    this.increasePC();
    this.tick(8);
    if (this.getFlagC() === 1) {
      const addressLsb = this.bus.read(this.getSP());
      this.tick(4);
      this.increaseSP();
      const addressMsb = this.bus.read(this.getSP());
      this.tick(4);
      this.increaseSP();

      const address = (addressMsb << 8) + addressLsb;
      this.setPC(address);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0xD9: RETI, unconditional return from interrupt, sets ime to 1
  private reti = () => {
    this.increasePC(); // not really needed
    this.tick(4);
    const addressLsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const addressMsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const address = (addressMsb << 8) + addressLsb;

    this.setPC(address);
    this.tick(4);
    this.interrupts.enableInterrupts();
  };

  // 0xDA: JP C,a16
  private jpCa16 = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const addressMsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (addressMsb << 8) + addressLsb;

    if (this.getFlagC() === 1) {
      this.setPC(address);
      this.tick(4);
      return true;
    } else {
      return false;
    }
  };

  // 0xDC: CALL C,a16
  private callCa16 = () => {
    this.increasePC();
    this.tick(4);
    // get address
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = (msb << 8) + lsb;
    if (this.getFlagC() === 1) {
      // back up current address and jump to location
      const currentPC = this.getPC();
      const pcLsb = currentPC & 0xff;
      const pcMsb = (currentPC >> 8) & 0xff;

      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcMsb);
      this.decreaseSP();
      this.bus.write(this.getRegisterSP(), pcLsb);
      this.setPC(address);
      this.tick(12);
      return true;
    }
    return false;
  };

  // 0xDE: SBC A,d8
  private sbcAd8 = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const carry = this.getFlagC();
    const n = this.bus.read(this.getPC());
    this.increasePC();

    const result = (a - n - carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 1;
    const hFlag = (a & 0xf) - (n & 0xf) - carry < 0 ? 1 : 0;
    const cFlag = (a & 0xff) - (n & 0xff) - carry < 0 ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);
    this.tick(4);
  };

  // 0xDF RST 18H - restart to absolute fixed address
  private rst18H = () => {
    this.increasePC();
    const address = 0x18;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xE0: load A into the specified 8 bit address + 0xFF00
  private ldha8A = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = 0xff00 | addressLsb;
    const value = this.getRegisterA();
    this.bus.write(address, value);
    this.tick(4);
  };

  // 0xE1: POP HL
  private popHL = () => {
    this.increasePC();
    this.tick(4);
    const dataLsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const dataMsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const data = (dataMsb << 8) + dataLsb;
    this.setRegisterHL(data);
  };

  // 0xE2: LD (C),A, load whatever is in A to address +0xFF00 in C
  private ldCaddrA = () => {
    this.increasePC();
    const addressLsb = this.getRegisterC();
    const address = 0xff00 + addressLsb;
    const value = this.getRegisterA();
    this.bus.write(address, value);

    this.tick(8);
  };

  // 0xE5: PUSH HL
  private pushHL = () => {
    this.push16(this.getRegisterHL());
  };

  // 0xE6: AND d8
  private andd8 = () => {
    this.increasePC();
    this.tick(4);
    const n = this.bus.read(this.getPC());
    this.increasePC();
    const result = this.getRegisterA() & n;
    this.setRegisterA(result);
    if (result === 0) {
      this.setFlagZ(1);
    } else {
      this.setFlagZ(0);
    }
    this.setFlagN(0);
    this.setFlagH(1);
    this.setFlagC(0);

    this.tick(4);
  };

  // 0xE7 RST 20H - restart to absolute fixed address
  private rst20H = () => {
    this.increasePC();
    const address = 0x20;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xE8: ADD SP,r8
  private addSPr8 = () => {
    this.increasePC();
    this.tick(4);
    const relativeAddressUnsigned = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const relativeAddressSigned = signedFrom8Bits(relativeAddressUnsigned);

    const sp = this.getSP();
    const result = (sp + relativeAddressSigned) & 0xffff;
    this.setRegisterSP(result);

    const zFlag = 0;
    const nFlag = 0;
    const cFlag = (sp & 0xff) + (relativeAddressSigned & 0xff) > 0xff ? 1 : 0;
    const hFlag = (sp & 0xf) + (relativeAddressSigned & 0xf) > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(8);
  };

  // 0xE9: JP (HL), unconditional jump to 16bit address
  private jpUnconditionalHl = () => {
    this.increasePC();
    // get address
    const address = this.getRegisterHL();
    this.setPC(address);

    this.tick(4);
  };

  // 0xEA: load A to 16 bit address defined by immediate
  private lda16A = () => {
    this.increasePC();
    this.tick(4);
    const value = this.getRegisterA();
    // get address
    const lsb = this.bus.read(this.getPC());
    this.tick(4);
    this.increasePC();
    const msb = this.bus.read(this.getPC());
    this.tick(4);
    this.increasePC();
    const address = (msb << 8) + lsb;
    this.bus.write(address, value);
    this.tick(4);
  };

  // 0xEE: XOR d8
  private xord8 = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const r = this.bus.read(this.getRegisterPC());
    this.increasePC();
    const result = a ^ r;
    this.setRegisterA(result);
    // Set Z flag
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);
    this.tick(4);
  };

  // 0xEF RST 28H - restart to absolute fixed address
  private rst28H = () => {
    this.increasePC();
    const address = 0x28;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xF0: load value specified in 8 bit address + 0xFF00 into A
  private ldhAa8 = () => {
    this.increasePC();
    this.tick(4);
    const addressLsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const address = 0xff00 | addressLsb;
    const value = this.bus.read(address);
    this.tick(4);
    this.setRegisterA(value);
  };

  // 0xF1: POP AF
  private popAF = () => {
    this.increasePC();
    this.tick(4);
    const dataLsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const dataMsb = this.bus.read(this.getSP());
    this.increaseSP();
    this.tick(4);
    const data = (dataMsb << 8) + dataLsb;
    this.setRegisterAF(data & 0xfff0); // this command impacts the flags, last 4 bits are always 0
  };

  // 0xF2: LD A,(C)
  private ldACAddr = () => {
    this.increasePC();
    this.tick(4);
    const address = 0xff00 | this.getRegisterC();
    const value = this.bus.read(address);
    this.setRegisterA(value);
    this.tick(4);
  };

  // 0xF3: DI disable interrupts
  private di = () => {
    this.increasePC();
    this.tick(4);
    this.interrupts.disableInterrupts();
  };

  // 0xF5: PUSH AF
  private pushAF = () => {
    this.push16(this.getRegisterAF());
  };

  // 0xF6: OR d8
  private ord8 = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const v = this.bus.read(this.getPC());
    this.increasePC();
    const result = a | v;
    this.setRegisterA(result);
    const zFlag = result === 0 ? 1 : 0;
    this.setFlagZ(zFlag);
    this.setFlagN(0);
    this.setFlagC(0);
    this.setFlagH(0);

    this.tick(4);
  };

  // 0xF8 LD HL,SP+r8
  private ldHLSPr8 = () => {
    this.increasePC();
    this.tick(4);
    const e = signedFrom8Bits(this.bus.read(this.getPC()));
    this.increasePC();
    const sp = this.getSP();
    const result = (sp + e) & 0xffff;
    this.setRegisterHL(result);

    const zFlag = 0;
    const nFlag = 0;
    const cFlag = (sp & 0xff) + (e & 0xff) > 0xff ? 1 : 0;
    const hFlag = (sp & 0xf) + (e & 0xf) > 0xf ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(8);
  };

  // 0xF7 RST 30H - restart to absolute fixed address
  private rst30H = () => {
    this.increasePC();
    const address = 0x30;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xF9: LD SP,HL
  private ldSPHL = () => {
    this.increasePC();
    this.setRegisterSP(this.getRegisterHL());
    this.tick(8);
  };

  // 0xFA: LD A,(a16)
  private ldAa16 = () => {
    this.increasePC();
    this.tick(4);
    const lsb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);
    const msb = this.bus.read(this.getPC());
    this.increasePC();
    this.tick(4);

    const address = (msb << 8) + lsb;

    const value = this.bus.read(address);
    this.setRegisterA(value);
    this.tick(4);
  };

  // 0xFE: CP d8
  private cpd8 = () => {
    this.increasePC();
    this.tick(4);
    const a = this.getRegisterA();
    const n = this.bus.read(this.getPC());
    this.increasePC();
    const result = (a - n) & 0xff;

    const zFlag = result === 0 ? 1 : 0;

    this.setFlagZ(zFlag);

    this.setFlagN(1);

    // check if the lower bytes rolled over
    const hFlag = (a & 0xf) - (n & 0xf) < 0 ? 1 : 0;
    this.setFlagH(hFlag);

    // check if the entire substraction rolls over
    const cFlag = a - n < 0 ? 1 : 0;
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // 0xFF RST 38H - restart to absolute fixed address
  private rst38H = () => {
    this.increasePC();
    const address = 0x38;

    const currentPC = this.getPC();
    const pcMsb = (currentPC >> 8) & 0xff;
    const pcLsb = currentPC & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);
    this.setPC(address);

    this.tick(16);
  };

  // 0xFF: enable interrupts at the next cycle
  private ei = () => {
    this.increasePC();
    this.enableInterruptsOnNextCycle = true;
    this.tick(4);
  };

  // Some more helper functions

  // add helper
  private add = (registerValue: number) => {
    this.increasePC();
    const a = this.getRegisterA();
    const v = registerValue;
    const result = (a + v) & 0xff;

    this.setRegisterA(result);
    const zFlag = result === 0 ? 1 : 0;
    const hFlag = (a & 0xf) + (v & 0xf) > 0xf ? 1 : 0;
    const cFlag = a + v > 0xff ? 1 : 0;

    this.setFlagN(0);
    this.setFlagZ(zFlag);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // sub helper
  sub = (v: number) => {
    this.increasePC();
    const a = this.getRegisterA();
    const result = (a - v) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 1;
    const cFlag = a - v < 0 ? 1 : 0;
    const hFlag = (a & 0xf) - (v & 0xf) < 0 ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagC(cFlag);
    this.setFlagH(hFlag);

    this.tick(4);
  };

  // sbc helper
  sbc = (n: number) => {
    this.increasePC();
    const a = this.getRegisterA();
    const carry = this.getFlagC();

    const result = (a - n - carry) & 0xff;
    this.setRegisterA(result);

    const zFlag = result === 0 ? 1 : 0;
    const nFlag = 1;
    const hFlag = (a & 0xf) - (n & 0xf) - carry < 0 ? 1 : 0;
    const cFlag = (a & 0xff) - (n & 0xff) - carry < 0 ? 1 : 0;

    this.setFlagZ(zFlag);
    this.setFlagN(nFlag);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);

    this.tick(4);
  };

  // Helper function for add when the target register is HL.
  private addHL = (value: number) => {
    this.increasePC();
    const hl = this.getRegisterHL();
    const result = (hl + value) & 0xffff;
    this.setRegisterHL(result);

    const hFlag = (hl & 0xfff) + (value & 0xfff) > 0xfff ? 1 : 0;
    const cFlag = hl + value > 0xffff ? 1 : 0;

    this.setFlagN(0);
    this.setFlagH(hFlag);
    this.setFlagC(cFlag);

    // the order is not too important here since we're not accessing any timer values in this function.
    this.tick(8);
  };

  // Another helper function to load what's stored at address provided in HL into another register.
  private ldRHL = (setValue: (value: number) => void) => {
    this.increasePC();
    this.tick(4);
    const address = this.getRegisterHL();
    const value = this.bus.read(address);
    this.tick(4);
    setValue(value);
  };

  private callInterrupt = (interruptHanlderAddress: number) => {
    // Store PC to the stack
    this.halted = false;
    this.interrupts.disableInterrupts();
    const currentPC = this.getPC();
    const pcLsb = currentPC & 0xff;
    const pcMsb = (currentPC >> 8) & 0xff;

    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcMsb);
    this.decreaseSP();
    this.bus.write(this.getRegisterSP(), pcLsb);

    this.setPC(interruptHanlderAddress & 0xffff);

    this.tick(5 * 4);
  };

  // Instruction lookup table, we're storing the name of an instruction too make debugging easier
  private instructions: { [key: number]: Instruction } = {
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

  // Getters registers

  getRegisterA() {
    return this.registers.AF & 0xff;
  }

  getRegisterB() {
    return this.registers.BC & 0xff;
  }

  getRegisterC() {
    return (this.registers.BC >> 8) & 0xff;
  }

  getRegisterD() {
    return this.registers.DE & 0xff;
  }

  getRegisterE() {
    return (this.registers.DE >> 8) & 0xff;
  }

  getRegisterF() {
    return (this.registers.AF >> 8) & 0xff;
  }

  getRegisterH() {
    return this.registers.HL & 0xff;
  }

  getRegisterL() {
    return (this.registers.HL >> 8) & 0xff;
  }

  // Undo the endianess
  getRegisterAF() {
    return toBigEndian(this.registers.AF);
  }

  getRegisterBC() {
    return toBigEndian(this.registers.BC);
  }

  getRegisterDE() {
    return toBigEndian(this.registers.DE);
  }

  getRegisterHL() {
    return toBigEndian(this.registers.HL);
  }

  getRegisterSP() {
    return toBigEndian(this.registers.SP);
  }

  getRegisterPC() {
    return toBigEndian(this.registers.PC);
  }

  // Setters registers

  setRegisterA(value: number) {
    this.registers.AF = (this.getRegisterF() << 8) + (value & 0xff);
  }

  setRegisterB(value: number) {
    this.registers.BC = (this.getRegisterC() << 8) + (value & 0xff);
  }

  setRegisterC(value: number) {
    this.registers.BC = this.getRegisterB() + ((value & 0xff) << 8);
  }

  setRegisterD(value: number) {
    this.registers.DE = (this.getRegisterE() << 8) + (value & 0xff);
  }

  setRegisterE(value: number) {
    this.registers.DE = this.getRegisterD() + ((value & 0xff) << 8);
  }

  setRegisterH(value: number) {
    this.registers.HL = (this.getRegisterL() << 8) + (value & 0xff);
  }

  setRegisterL(value: number) {
    this.registers.HL = this.getRegisterH() + ((value & 0xff) << 8);
  }

  setRegisterF(value: number) {
    this.registers.AF = ((value & 0xff) << 8) + this.getRegisterA();
  }

  setRegisterAF(value: number) {
    this.registers.AF = toLittleEndian(value) & 0xffff;
  }

  setRegisterBC(value: number) {
    this.registers.BC = toLittleEndian(value) & 0xffff;
  }

  setRegisterDE(value: number) {
    this.registers.DE = toLittleEndian(value) & 0xffff;
  }

  setRegisterHL(value: number) {
    this.registers.HL = toLittleEndian(value) & 0xffff;
  }

  setRegisterSP(value: number) {
    this.registers.SP = toLittleEndian(value) & 0xffff;
  }

  setRegisterPC(value: number) {
    this.registers.PC = toLittleEndian(value) & 0xffff;
  }

  // getters flags

  getFlags(): number {
    return this.getRegisterF();
  }

  // bits 7 to 0
  // 7	z	Zero flag
  // 6	n	Subtraction flag (BCD)
  // 5	h	Half Carry flag (BCD)
  // 4	c	Carry flag
  getFlagZ() {
    return (this.getFlags() >> 7) & 1;
  }

  getFlagN() {
    return (this.getFlags() >> 6) & 1;
  }

  getFlagH() {
    return (this.getFlags() >> 5) & 1;
  }

  getFlagC() {
    return (this.getFlags() >> 4) & 1;
  }

  // setters flags

  setFlags(value: number) {
    this.setRegisterF(value);
  }

  setFlagZ(value: number) {
    this.setFlags((value << 7) | (this.getFlags() & 0b0111_1111)); // 0b0111_1111 = every bit but the z flag
  }

  setFlagN(value: number) {
    this.setFlags((value << 6) | (this.getFlags() & 0b1011_1111)); // every bit but the n flag
  }

  setFlagH(value: number) {
    this.setFlags((value << 5) | (this.getFlags() & 0b1101_1111)); // every bit but the h flag
  }

  setFlagC(value: number) {
    this.setFlags((value << 4) | (this.getFlags() & 0b1110_1111)); // every bit but the c flag
  }

  increasePC() {
    this.setRegisterPC((this.getRegisterPC() + 1) & 0xffff);
  }

  increaseSP() {
    this.setRegisterSP((this.getRegisterSP() + 1) & 0xffff);
  }

  decreaseSP() {
    this.setRegisterSP((this.getRegisterSP() - 1) & 0xffff);
  }

  getPC() {
    return this.getRegisterPC();
  }

  setPC(value: number) {
    this.setRegisterPC(value);
  }

  getSP() {
    return this.getRegisterSP();
  }

  getRawRegistersForTesting() {
    return this.registers;
  }

  printRegisters() {
    const af = toHexString(this.getRegisterAF(), 16);
    const bc = toHexString(this.getRegisterBC(), 16);
    const de = toHexString(this.getRegisterDE(), 16);
    const hl = toHexString(this.getRegisterHL(), 16);
    const sp = toHexString(this.getRegisterSP(), 16);
    const pc = toHexString(this.getRegisterPC(), 16);

    console.log(`Registers: AF: ${af}\tBC: ${bc}\tDE: ${de}\tHL: ${hl}\tSP: ${sp}\tPC: ${pc}`);
  }

  printFlags() {
    const z = this.getFlagZ();
    const n = this.getFlagN();
    const h = this.getFlagH();
    const c = this.getFlagC();

    console.log(`Flags: z: ${z}\tn: ${n}\th: ${h}\tc: ${c}`);
  }

  private recordedPcs: number[] = [];
  private recordPcs = false;

  startRecordingPcs() {
    this.recordPcs = true;
    this.recordedPcs.length = 0;
    console.log("started recording pcs");
  }

  stopRecordingPcs() {
    this.recordPcs = false;
    console.log("stopped recording pcs");
    this.recordedPcs.sort(function (a, b) {
      return a - b;
    });
    // uniq values
    const result = this.recordedPcs.filter((value, index) => index === this.recordedPcs.indexOf(value));
    console.log("recorded pcs:");
    console.log(result);
  }
}
