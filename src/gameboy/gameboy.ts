import { APUImpl, APU } from "./apu";
import { Bus, BusImpl } from "./bus";
import { createCart, CartridgeType } from "./cart";
import { CPU } from "./cpu";
import { DMAImpl } from "./dma";
import { InterruptsImpl } from "./interrupts";
import { JoyPad, JoyPadImpl } from "./joypad";
import { PPUImpl, PPU } from "./ppu";
import { RamImpl } from "./ram";
import { SerialImpl } from "./serial";
import { TimerImpl } from "./timer";
import { toHexString } from "./utils";

export class Gameboy {
  private cpu: CPU | undefined;
  private bus: Bus | undefined;
  private joypad: JoyPad | undefined;
  private ppu: PPU | undefined;
  private apu: APU | undefined;
  private cartridgeType: CartridgeType | undefined;

  load(rom: Uint8Array) {
    this.readRomInfo(rom);
    const interrupts = new InterruptsImpl();

    const cart = createCart(this.cartridgeType!, rom);
    const ram = new RamImpl();

    // Our canvases
    // main screen
    const screenCanvas = document.getElementById("screen") as HTMLCanvasElement;

    // The full background layer for debugging.
    const backgroundCanvas = document.getElementById("background") as HTMLCanvasElement;

    // Tile canvas, just containing all background tiles for debugging.
    const tileCanvas = document.getElementById("tiles") as HTMLCanvasElement;

    this.ppu = new PPUImpl(screenCanvas, tileCanvas, backgroundCanvas, interrupts);
    const serial = new SerialImpl(interrupts);
    const timer = new TimerImpl(interrupts);
    this.joypad = new JoyPadImpl(interrupts);
    this.apu = new APUImpl();
    this.bus = new BusImpl(
      cart,
      ram,
      interrupts,
      this.ppu,
      serial,
      timer,
      (startAddress) => dma.writeFF46(startAddress),
      this.joypad,
      this.apu,
    );
    const dma = new DMAImpl(this.bus, this.ppu);
    this.cpu = new CPU(this.bus, interrupts, this.ppu, this.apu, serial, dma, timer);
    this.cpu.run();
  }

  startDebug() {
    this.cpu!.startDebug();
    this.bus!.enableDebugLog();
  }

  getNextCommands(): [number, string][] {
    return this.cpu!.getNextCommands();
  }

  getStackInfo(): number[] {
    return this.cpu!.getStackInfo();
  }

  kill() {
    // This will stop cpu and can't be resumed. After calling this,
    // you'll need to create a new gameboy instance.
    this.cpu?.kill();
  }

  mute() {
    this.apu?.mute();
  }

  unmute() {
    this.apu?.unmute();
  }

  // register name, register content
  getRegisterInfo(): [string, string][] {
    return [
      ["A", toHexString(this.cpu!.getRegisterA())],
      ["F", toHexString(this.cpu!.getRegisterF())],
      ["B", toHexString(this.cpu!.getRegisterB())],
      ["C", toHexString(this.cpu!.getRegisterC())],
      ["D", toHexString(this.cpu!.getRegisterD())],
      ["E", toHexString(this.cpu!.getRegisterE())],
      ["H", toHexString(this.cpu!.getRegisterH())],
      ["L", toHexString(this.cpu!.getRegisterL())],
      ["SP", toHexString(this.cpu!.getRegisterSP())],
      ["PC", toHexString(this.cpu!.getRegisterPC())],
    ];
  }

  getPC(): number {
    return this.cpu!.getPC();
  }

  // Flag name, flag content
  getFlagInfo(): [string, number][] {
    return [
      ["Z", this.cpu!.getFlagZ()],
      ["N", this.cpu!.getFlagN()],
      ["H", this.cpu!.getFlagH()],
      ["C", this.cpu!.getFlagC()],
    ];
  }

  step(count: number = 1) {
    for (let i = 0; i < count; i++) {
      const logStatements = count === 1;
      this.cpu!.step(logStatements);
    }
  }

  continue() {
    this.cpu!.continue();
    this.bus!.disableDebugLog();
  }

  idToCartridgeType: { [key: number]: CartridgeType } = {
    0x00: "ROM-ONLY",
    0x01: "MBC1",
    0x02: "MBC1+RAM",
    0x03: "MBC1+RAM+BATTERY",
    0x05: "MBC2",
    0x06: "MBC2+BATTERY",
    0x19: "MBC5",
    0x1a: "MBC5+RAM",
    0x1b: "MBC5+RAM+BATTERY",
    0x1c: "MBC5+RUMBLE",
    0x1d: "MBC5+RUMBLE+RAM",
    0x1e: "MBC5+RUMBLE+RAM+BATTERY",
  };

  getCartridgeType() {
    return this.cartridgeType ?? "UNKNOWN";
  }

  private readRomInfo(rom: Uint8Array) {
    // Cart header goes from $0100—$014F

    // Just the title: 0134-0143 — Title
    let title = "";
    for (let i = 0x134; i < 0x143; i++) {
      title = title + String.fromCharCode(rom[i]);
    }

    const cartrigeType = rom[0x147];
    if (this.idToCartridgeType[cartrigeType] === undefined) {
      throw new Error("Sorry, unsupported cartriged type: " + toHexString(cartrigeType));
    }
    this.cartridgeType = this.idToCartridgeType[cartrigeType];

    console.log(`title: ${title}\tcartridg type: ${toHexString(cartrigeType)}, rom size: ${rom.length}`);
  }

  pressStart() {
    this.joypad!.pressStartButton();
  }

  releaseStart() {
    this.joypad!.releaseStartButton();
  }

  pressSelect() {
    this.joypad!.pressSelectButton();
  }

  releaseSelect() {
    this.joypad!.releaseSelectButton();
  }

  pressA() {
    this.joypad!.pressAButton();
  }

  releaseA() {
    this.joypad!.releaseAButton();
  }

  pressB() {
    this.joypad!.pressBButton();
  }

  releaseB() {
    this.joypad!.releaseBButton();
  }

  pressLeft() {
    this.joypad!.pressLeft();
  }

  releaseLeft() {
    this.joypad!.releaseLeft();
  }

  pressRight() {
    this.joypad!.pressRight();
  }

  releaseRight() {
    this.joypad!.releaseRight();
  }

  pressUp() {
    this.joypad!.pressUp();
  }

  releaseUp() {
    this.joypad!.releaseUp();
  }

  pressDown() {
    this.joypad!.pressDown();
  }

  releaseDown() {
    this.joypad!.releaseDown();
  }
}
