export type CartridgeType =
  | "ROM-ONLY"
  | "MBC1"
  | "MBC1+RAM"
  | "MBC1+RAM+BATTERY"
  | "MBC2"
  | "MBC2+BATTERY"
  | "MBC3"
  | "MBC3+RAM"
  | "MBC3+RAM+BATTERY"
  | "MBC3+TIMER+BATTERY"
  | "MBC3+TIMER+RAM+BATTERY"
  | "MBC5"
  | "MBC5+RAM"
  | "MBC5+RAM+BATTERY"
  | "MBC5+RUMBLE"
  | "MBC5+RUMBLE+RAM"
  | "MBC5+RUMBLE+RAM+BATTERY"
  | "UNKNOWN";

export type CartridgeInfo = {
  title: string;
};

export function createCart(type: CartridgeType, rom: Uint8Array, cartridgeInfo: CartridgeInfo): Cart {
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

export interface Cart {
  read(address: number): number;
  write(address: number, value: number): void;
}

export class CartImplRomOnly implements Cart {
  constructor(readonly rom: Uint8Array) {}

  read(address: number): number {
    return this.rom[address];
  }

  write(address: number, value: number): void {
    // Some games such as tetris seem to be buggy and write to this addr anyway (e.g. tetris writes to 0x2000)
    // so let's not throw an error.
    // https://www.reddit.com/r/EmuDev/comments/zddum6/gameboy_tetris_issues_with_getting_main_menu_to/
  }
}

export class CartImpMBC1 implements Cart {
  private selectedRomBank = 1;

  private selectedRamBank = 0;

  private mode = 0;

  private ramEnabled = false;

  // Keep it simple, 4 possible ram banks
  private ramBanks: number[] = [];

  constructor(
    readonly rom: Uint8Array,
    private cartridgeInfo: CartridgeInfo,
  ) {
    const existingRam = localStorage.getItem(this.cartridgeInfo.title);
    if (existingRam) {
      this.ramBanks = JSON.parse(existingRam);
    }
  }

  read(address: number): number {
    if (address >= 0 && address <= 0x3fff) {
      return this.rom[address];
    }
    if (address >= 0x4000 && address <= 0x7fff) {
      // Switchable Rom Bank
      return this.rom[this.selectedRomBank * 0x4000 + (address - 0x4000)];
    } else if (address >= 0xa000 && address <= 0xbfff) {
      if (this.ramEnabled) {
        if (this.mode === 0) {
          return this.ramBanks[address - 0xa000];
        } else {
          return this.ramBanks[this.selectedRamBank * 0x2000 + (address - 0xa000)];
        }
      } else {
        return 0x00;
      }
    } else {
      throw Error("cart memory region not supported");
    }
  }

  lastPersisted = 0;

  persistRam() {
    const now = performance.now();
    if (now - this.lastPersisted > 3_000) {
      this.lastPersisted = now;
      localStorage.setItem(this.cartridgeInfo.title, JSON.stringify(this.ramBanks));
    }
  }

  write(address: number, value: number): void {
    // Ram writes
    if (address >= 0xa000 && address <= 0xbfff) {
      if (this.ramEnabled) {
        if (this.mode === 0) {
          this.ramBanks[address - 0xa000] = value;
        } else {
          this.ramBanks[this.selectedRamBank * 0x2000 + (address - 0xa000)] = value;
        }
        // this.persistRam();
        return;
      } else {
        // ignore ram write to disabled ram
        return;
      }
    }

    // MBC1 register writes:
    if (address >= 0x0 && address <= 0x1fff) {
      if ((value & 0xf) === 0xa) {
        this.ramEnabled = true;
      } else {
        this.ramEnabled = false;
      }
      return;
    }

    if (address >= 0x2000 && address <= 0x3fff) {
      //
      const romBank = (value & 0b0001_1111) | (this.selectedRomBank & 0b0110_0000);
      // Rom romBank 0 gets automatcially converted to 1 because you cant map 0 twice,
      // this also applies to banks 0x20, 0x40 and 0x60
      if (romBank == 0x00 || romBank == 0x20 || romBank == 0x40 || romBank == 0x60) {
        this.selectedRomBank = romBank + 1;
      } else {
        this.selectedRomBank = romBank;
      }

      return;
    }

    if (address >= 0x4000 && address <= 0x5fff) {
      if (this.mode === 0) {
        // rom banking mode
        const highBitsRomBank = value & 0b0110_0000;
        this.selectedRomBank = (this.selectedRomBank & 0b11111) | (highBitsRomBank << 5);
      } else {
        // ram banking mode
        const ramBank = value & 0x3;
        this.selectedRamBank = ramBank;
      }

      return;
    }

    if (address >= 0x6000 && address <= 0x7fff) {
      this.mode = value & 0x1;
      return;
    }
  }
}

export class CartImpMBC2 implements Cart {
  private selectedRomBank = 1;

  private ramEnabled = false;

  private ram: number[] = [];

  constructor(readonly rom: Uint8Array) {}

  read(address: number): number {
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
      const lower9Bits = address & 0b1_1111_1111;
      return this.ram[lower9Bits];
    }

    return 0;
  }
  write(address: number, value: number): void {
    // Ram enable + rom bank register
    if (address >= 0x0 && address <= 0x3fff) {
      // least significant bit of upper address byte controls ram/rom config
      // Shift out lower byte of address
      const bit8 = ((address & 0xffff) >> 8) & 0x1;
      if (!bit8) {
        // ram config
        if ((value & 0xff) === 0x0a) {
          this.ramEnabled = true;
        } else {
          this.ramEnabled = false;
        }
      } else {
        // rom config
        if ((value & 0xff) === 0) {
          this.selectedRomBank = 1;
        } else {
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
      const lower9Bits = address & 0b1_1111_1111;
      this.ram[lower9Bits] = value & 0xff;
    }
  }
}

export class CartImpMBC3 implements Cart {
  private selectedRomBank = 1;

  private selectedRamBank = 1;
  private ramBanks: number[][] = [];

  private ramAndRtcEnabled = false;
  // 0xa000-0xbfff can be mapped to either ram or RTC.
  // If this value is set then mapping is set to RTC.
  private selectedRTCRegister: number | null = null;
  // We've got 5 rtc registers
  private rtcRegisters = [0, 0, 0, 0, 0];

  // True when last write to latch was 0x00;
  private latchWrote00 = false;

  constructor(
    readonly rom: Uint8Array,
    private startTime = performance.now(),
  ) {}

  read(address: number): number {
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
          return this.ramBanks[this.selectedRamBank][address - 0xa000] ?? 0x0;
        } else {
          return this.rtcRegisters[this.selectedRTCRegister];
        }
      }
    }

    return 0;
  }

  write(address: number, value: number): void {
    if (address >= 0x0 && address <= 0x1fff) {
      if ((value & 0xff) === 0x0a) {
        this.ramAndRtcEnabled = true;
      } else {
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
        } else {
          this.rtcRegisters[this.selectedRTCRegister] = value & 0xff;
        }
      }
    }

    if (address >= 0x2000 && address <= 0x3fff) {
      // 7 bits rom bank
      if (value === 0) {
        this.selectedRomBank = 1;
      } else {
        this.selectedRomBank = value & 0b0111_1111;
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
      } else {
        if (value === 0x1) {
          this.latchClockData();
        }
        this.latchWrote00 = false;
      }
    }
  }

  latchClockData() {
    // We'll only fill seconds, minutes and hours and the lower bits for days for now
    const totalSeconds = (performance.now() - this.startTime) / 1000;
    const days = Math.floor(totalSeconds / (3600 * 24));
    const remainingSeconds = totalSeconds % (3600 * 24);
    const hours = Math.floor(remainingSeconds / 3600);
    const remainingMinutes = remainingSeconds % 3600;
    const minutes = Math.floor(remainingMinutes / 60);
    const seconds = Math.floor(remainingMinutes % 60);

    this.rtcRegisters[0] = seconds & 0xff;
    this.rtcRegisters[1] = minutes & 0xff;
    this.rtcRegisters[2] = hours & 0xff;
    this.rtcRegisters[3] = days & 0xff;
    this.rtcRegisters[4] = 0; // upper one bit of day counter + halt (6) + carry (7)
  }
}

export class CartImpMBC5 implements Cart {
  private selectedRomBank = 1;

  private selectedRamBank = 1;
  private ramBanks: number[][] = [];

  private ramEnabled = false;

  constructor(readonly rom: Uint8Array) {}

  read(address: number): number {
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
  }
  write(address: number, value: number): void {
    if (address >= 0x0 && address <= 0x1fff) {
      if (value === 0x0a) {
        this.ramEnabled = true;
      } else {
        // Todo (disable only for 0x0?)
        this.ramEnabled = false;
      }
    }

    if (address >= 0x2000 && address <= 0x2fff) {
      // 8 most significant bits for rom bank
      this.selectedRomBank = (this.selectedRomBank & 0b1_0000_0000) | (value & 0xff);
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
  }
}
