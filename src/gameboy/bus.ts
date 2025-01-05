import { APU } from "./apu";
import { Cart } from "./cart";
import { Interrupts } from "./interrupts";
import { JoyPad } from "./joypad";
import { PPU } from "./ppu";
import { Ram } from "./ram";
import { Serial } from "./serial";
import { Timer } from "./timer";
import { toHexString } from "./utils";

export interface Bus {
  read(address: number): number; // reads a single byte
  read(address: number, skipDebugging: boolean): number;
  write(address: number, value: number): void; // writes a single byte
  write(address: number, value: number, skipDebugging: boolean): void;
  enableDebugLog(): void;
  disableDebugLog(): void;
}

/**
 * Simple bus implementation. Known issues:
 * - missing proper serial support (serial reads) for multiplayer games
 * - we haven't implemented some PPU reads
 */
export class BusImpl implements Bus {
  private debugging = false;

  private booting = true;

  constructor(
    readonly bootRom: Uint8Array,
    readonly cart: Cart,
    readonly ram: Ram,
    readonly interrupts: Interrupts,
    private ppu: PPU,
    private serial: Serial,
    private timer: Timer,
    private writeFF46: (startAddress: number) => void,
    private joypad: JoyPad,
    private apu: APU,
  ) {}

  read(address: number, skipDebugging = false): number {
    let result = 0;

    if (address <= 0xff && this.booting) {
      result = this.bootRom[address];
    }

    // 16 KiB ROM bank 00	From cartridge, usually a fixed bank
    else if (address >= 0x0000 && address <= 0x3fff) {
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
    } else if (address >= 0xe000 && address <= 0xfdff) {
      // Mirros the working ram but shouldn't be used acutally
      result = this.ram.readWorkingRam(address - 0xe000);
    }
    // Object attribute memory (OAM)
    else if (address >= 0xfe00 && address <= 0xfe9f) {
      result = this.ppu.readOAM(address - 0xfe00);
    }
    // Not Usable	Nintendo says use of this area is prohibited.
    else if (address >= 0xfea0 && address <= 0xfeff) {
      throw new Error("not usable area read for address " + toHexString(address) + " not implemented");
    }
    // I/O Registers
    else if (address >= 0xff00 && address <= 0xff7f) {
      if (address === 0xff00) {
        result = this.joypad.getJOYP();
      } else if (address === 0xff01) {
        result = this.serial.readSB();
      } else if (address === 0xff02) {
        result = this.serial.readSC();
      } else if (address === 0xff04) {
        result = this.timer.getTimerDiv();
      } else if (address === 0xff05) {
        result = this.timer.getTimerCounter();
      } else if (address === 0xff0f) {
        result = this.interrupts.getInterruptFlag();
      } else if (address >= 0xff10 && address <= 0xff3f) {
        // Audio
        if (address === 0xff10) {
          result = this.apu.readChannel1Sweep();
        } else if (address === 0xff11) {
          result = this.apu.readChannel1Duty();
        } else if (address === 0xff12) {
          result = this.apu.readChannel1VolumeAndEnvelope();
        } else if (address === 0xff13) {
          result = 0x00; // write only
        } else if (address === 0xff14) {
          result = this.apu.readChannel1LengthEnable();
        } else if (address === 0xff16) {
          result = this.apu.readChannel2Duty();
        } else if (address === 0xff17) {
          result = this.apu.readChannel2VolumeAndEnvelope();
        } else if (address === 0xff18) {
          result = 0x00; // write only
        } else if (address === 0xff19) {
          result = this.apu.readChannel2LengthEnable();
        } else if (address === 0xff1a) {
          result = this.apu.readChannel3DACOnOff();
        } else if (address === 0xff1c) {
          result = this.apu.readChannel3OutputLevel();
        } else if (address === 0xff1e) {
          result = this.apu.readChannel3Control();
        } else if (address === 0xff20) {
          // write only
          result = 0x00;
        } else if (address === 0xff21) {
          result = this.apu.readChannel4VolumeAndEnvelope();
        } else if (address === 0xff22) {
          result = this.apu.readChannel4FrequencyAndRandomness();
        } else if (address === 0xff23) {
          result = this.apu.readChannel4LengthEnable();
        } else if (address === 0xff24) {
          result = this.apu.readMasterVolume();
        } else if (address === 0xff25) {
          result = this.apu.readAudioChannelPanning();
        } else if (address === 0xff26) {
          result = this.apu.readAudioMasterControl();
        } else if (address >= 0xff30 && address <= 0xff3f) {
          result = this.apu.readChannel3WavePattern(address - 0xff30);
        } else {
          // ignore other audio reads
          result = 0x00;
        }
      } else if (address === 0xff40) {
        result = this.ppu.readFF40();
      } else if (address === 0xff41) {
        result = this.ppu.readFF41();
      } else if (address === 0xff42) {
        result = this.ppu.readFF42();
      } else if (address === 0xff43) {
        result = this.ppu.readFF43();
      } else if (address === 0xff44) {
        result = this.ppu.readFF44();
      } else if (address === 0xff45) {
        result = this.ppu.readFF45();
      } else if (address === 0xff47) {
        result = this.ppu.readFF47();
      } else if (address === 0xff48) {
        result = this.ppu.readFF48();
      } else if (address === 0xff49) {
        result = this.ppu.readFF49();
      } else if (address === 0xff4a) {
        result = this.ppu.readFF4A();
      } else if (address === 0xff4b) {
        result = this.ppu.readFF4B();
      } else if (address === 0xff4d) {
        // Todo: speed switch?
        // throw Error("ff4d speed switch not implemented");
        result = 0xff;
      } else if (address === 0xff4f) {
        // we don't support vram bank selects, that's a GBC thing
        result = 0x0;
      } else {
        throw new Error("io read for address " + toHexString(address) + " not implemented");
      }
    }
    // High RAM (HRAM)
    else if (address >= 0xff80 && address <= 0xfffe) {
      result = this.ram.readHighRam(address - 0xff80);
    }
    // Interrupt Enable register (IE)
    else if (address >= 0xffff && address <= 0xffff) {
      result = this.interrupts.getIE();
    } else {
      throw new Error("read outside of address space: " + toHexString(address) + "");
    }

    if (this.debugging && !skipDebugging) {
      console.log(
        `%cDebugger - bus: read value ${toHexString(result)} from address ${toHexString(address)}`,
        "background: #ffffff; color: #0000ff",
      );
    }

    return result;
  }

  write(address: number, value: number, skipDebugging = false) {
    if (this.debugging && !skipDebugging) {
      console.log(
        `%cDebugger - bus: writing ${toHexString(value)} to address ${toHexString(address)}`,
        "background: #ffffff; color: #ff0000",
      );
    }

    // This write disables the boot rom
    if (this.booting && address === 0xff50) {
      this.booting = false;
      return;
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
        } else if (address === 0xff26) {
          this.apu.writeAudioMasterControl(value);
          return;
        } else if (address >= 0xff30 && address <= 0xff3f) {
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
      } else if (address === 0xff4f) {
        // we don't support vram bank selects, that's a GBC thing
        return;
      }
      if (address === 0xff7f) {
        // Tetris writes to this memory location, we just ignore it
        // https://www.reddit.com/r/EmuDev/comments/5nixai/gb_tetris_writing_to_unused_memory/
        return;
      }
      throw new Error(
        "io write of value " + toHexString(value) + " to address " + toHexString(address) + " not implemented",
      );
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

    throw new Error("write outside of address space: " + toHexString(address) + "");
  }

  enableDebugLog(): void {
    this.debugging = true;
  }

  disableDebugLog(): void {
    this.debugging = false;
  }
}
