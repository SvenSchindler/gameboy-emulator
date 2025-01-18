import { APUImpl, APU } from "./apu";
import { ApuV2Impl } from "./apu-v2/apu-v2";
import { Bus, BusImpl } from "./bus";
import { createCart, CartridgeType, CartridgeInfo } from "./cart";
import { CPU } from "./cpu";
import { DMAImpl } from "./dma";
import { GameboyGamepad } from "./gameboy-gamepad";
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

  constructor(private enableWebGl: boolean) {}

  load(rom: Uint8Array) {
    const cartridgeInfo = this.readRomInfo(rom);
    const interrupts = new InterruptsImpl();

    // I'm not allowed to ship the original boot rom so we'll just use a mock one.
    // Feel free to replace it with your own.
    const bootRom = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe0, 0x50,
    ]);

    const cart = createCart(this.cartridgeType!, rom, cartridgeInfo);
    const ram = new RamImpl();

    // Our canvases
    // main screen
    const screenCanvas = document.getElementById("screen") as HTMLCanvasElement;

    // WebGl requires a higher resolution for the raster
    if (this.enableWebGl) {
      screenCanvas.width = 800;
      screenCanvas.height = 720;
      screenCanvas.style.imageRendering = "";
    }

    // The full background layer for debugging.
    const backgroundCanvas = document.getElementById("background") as HTMLCanvasElement;

    // Tile canvas, just containing all background tiles for debugging.
    const tileCanvas = document.getElementById("tiles") as HTMLCanvasElement;

    this.ppu = new PPUImpl(screenCanvas, tileCanvas, backgroundCanvas, interrupts, this.enableWebGl);
    const serial = new SerialImpl(interrupts);
    const timer = new TimerImpl(interrupts);
    this.joypad = new JoyPadImpl(interrupts);

    // I've implemented 2 APUs, a more precise one with pcm and stereo support which requires a bit more performance and a hacky one.
    // If you're running this on a slow machine you might want to replace this with the old apu
    // this.apu = new APUImpl();
    this.apu = new ApuV2Impl();

    this.bus = new BusImpl(
      bootRom,
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
    const gamepad = new GameboyGamepad(this.joypad);
    this.cpu = new CPU(this.bus, interrupts, this.ppu, this.apu, serial, dma, timer, () => gamepad.tick());
    this.cpu.start();
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

  setShowRetroScreen(value: boolean) {
    this.ppu?.setRetroModeEnabled(value);
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

  startRecordingPcs() {
    this.cpu?.startRecordingPcs();
  }

  stopRecordingPcs() {
    this.cpu?.stopRecordingPcs();
  }

  idToCartridgeType: { [key: number]: CartridgeType } = {
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

  getCartridgeType() {
    return this.cartridgeType ?? "UNKNOWN";
  }

  private readRomInfo(rom: Uint8Array): CartridgeInfo {
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

    return {
      title,
    };
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
