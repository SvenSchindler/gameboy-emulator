export type CartridgeType =
  | "ROM-ONLY"
  | "MBC1"
  | "MBC1+RAM"
  | "MBC1+RAM+BATTERY"
  | "UNKNOWN";

export function createCart(type: CartridgeType, rom: Uint8Array): Cart {
  switch (type) {
    case "ROM-ONLY":
      return new CartImplRomOnly(rom);
    case "MBC1":
      return new CartImpMBC1(rom);
    case "MBC1+RAM":
      return new CartImpMBC1(rom);
    case "MBC1+RAM+BATTERY":
      return new CartImpMBC1(rom);
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

  constructor(readonly rom: Uint8Array) {}

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
          return this.ramBanks[
            this.selectedRamBank * 0x2000 + (address - 0xa000)
          ];
        }
      } else {
        return 0x00;
      }
    } else {
      throw Error("cart memory region not supported");
    }
  }

  write(address: number, value: number): void {
    // Ram writes
    if (address >= 0xa000 && address <= 0xbfff) {
      if (this.ramEnabled) {
        if (this.mode === 0) {
          this.ramBanks[address - 0xa000] = value;
        } else {
          this.ramBanks[this.selectedRamBank * 0x2000 + (address - 0xa000)] =
            value;
        }
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
      const romBank =
        (value & 0b0001_1111) | (this.selectedRomBank & 0b0110_0000);
      // Rom romBank 0 gets automatcially converted to 1 because you cant map 0 twice,
      // this also applies to banks 0x20, 0x40 and 0x60
      if (
        romBank == 0x00 ||
        romBank == 0x20 ||
        romBank == 0x40 ||
        romBank == 0x60
      ) {
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
        this.selectedRomBank =
          (this.selectedRomBank & 0b11111) | (highBitsRomBank << 5);
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
