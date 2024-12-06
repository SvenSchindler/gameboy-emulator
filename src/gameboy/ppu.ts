import { Interrupts } from "./interrupts";
import { signedFrom8Bits, toHexString } from "./utils";

export interface PPU {
  setViewportY(value: number): void;
  setViewportX(value: number): void;
  getViewportY(): number;
  getViewportX(): number;
  setWindowYPosition(value: number): void;
  getWindowYPosition(): number;
  setWindowXPosition(value: number): void;
  getWindowXPosition(): number;
  setStatusRegister(value: number): void;
  getStatusRegister(): number;
  getLCDControlerRegister(): number;
  setLCDControlerRegister(value: number): void;
  setBackgroundColorPalette(value: number): void;
  getBackgroundColorPalette(): number;
  setObjectColorPalette0(value: number): void;
  setObjectColorPalette1(value: number): void;
  getObjectColorPalette0(): number;
  getObjectColorPalette1(): number;
  writeVram(address: number, value: number): void;
  readVram(address: number): number;
  writeOAM(address: number, value: number): void;
  readOAM(address: number): number;
  getLCDY(): number;
  setLYC(value: number): void;
  getLYC(): number;
  tick(): void;
  logDebugInfo(): void;
  kill(): void;
}

// Mode1 == VBLANK
type Mode = "Mode0" | "Mode1" | "Mode2" | "Mode3";

/**
 * Simple PPU Impl with a few debugging infos.
 * Known issues:
 * -> tileAddressingMode = (this.LCDC >> 4) & 0x1; for background/window is not updated between lines which breaks layout for some games.
 */
export class PPUImpl implements PPU {
  // killed is just for us to stop debugging outputs, otherwise
  // different gameboy instances would fight for the same canvas
  private killed = false;

  // VRAM 8000-9FFF, 8192 bytes
  private vram: number[] = [];

  // $FE00-FE9F, OAM, holds 160 bytes of object attributes, 40 entries, 4 bytes each
  private oam: number[] = [];

  // LCD control
  private LCDC = 0x91;

  // 0xFF41 STAT: LCD status register
  private STAT = 0;

  // 0xFF42
  private viewportY = 0;
  // 0xFF43
  private viewportX = 0;

  // 0xFF44 readonly
  private LY = 0;

  // 0xFF45
  private LYC = 0;

  // Just some different color palettes
  // private colors: number[][] = [
  //     [255,255,255,255],
  //     [100,100, 100,255],
  //     [70,70,70,255],
  //     [0,0,0,255],
  // ];

  // Classic gameboy green
  // private colors: number[][] = [
  //     [220,255,220,255],
  //     [80,100, 80,255],
  //     [50,70,50,255],
  //     [0,20,0,255],
  // ];

  // Toy blue
  private colors: number[][] = [
    [174, 255, 255, 255],
    [21, 205, 214, 255],
    [16, 173, 173, 255],
    [76, 17, 18, 255],
  ];

  // // Toy orange
  // private colors: number[][] = [
  //     [252,206,130,255],
  //     [250,178, 43,255],
  //     [226,151,29,255],
  //     [76,17,18,255],
  // ];

  // 0xFF47 background color palette
  private ff47 = 0x00;
  // We'll keep a copy with the actual colors
  private backgroundColorPalette: number[] = [];

  // 0xFF48 OBP0 object palette 0
  private objectColorPalette0: number[] = [];

  private ff48 = 0x00;

  // 0xFF49 OBP1 object palette 1
  private objectColorPalette1: number[] = [];

  private ff49 = 0x00;

  // FF4A WY
  private WY = 0;

  // FF4B WX
  private WX = 0;

  private tileCanvasContext: CanvasRenderingContext2D;

  private backgroundCanvasContext: CanvasRenderingContext2D;

  private lcdCanvasContext: CanvasRenderingContext2D;

  private tickCount = 0;

  private currentMode: Mode = "Mode2";

  private lcdCanvasData: ImageData;

  // For simplicity, we just maintain our own version of the 32x32 background pixel data
  // [y][x] => pixel color id
  private backgroundColorIdBuffer: number[][] = [];
  // Same for window
  private windowColorIdBuffer: number[][] = [];

  private framePixels: number[][] = [];

  // Sum of ticks for each mode...
  // totalTicksPerLine = 80 + 172 + 204
  private totalTicksPerLine = 456;
  private lineTick = 0;

  constructor(
    private lcdCanvas: HTMLCanvasElement,
    private tileCanvas: HTMLCanvasElement,
    private backgroundCanvas: HTMLCanvasElement,
    private interrupts: Interrupts,
  ) {
    this.tileCanvasContext = tileCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    this.lcdCanvasContext = lcdCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    this.backgroundCanvasContext = backgroundCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    this.lcdCanvasContext.imageSmoothingEnabled = false;
    this.drawTiles();
    this.lcdCanvasData = this.lcdCanvasContext.getImageData(
      0,
      0,
      this.lcdCanvas.width,
      this.lcdCanvas.height,
    );
  }

  setLYC(value: number): void {
    this.LYC = value & 0xff;
    this.checkLyLycInterrupt();
  }

  getLYC(): number {
    return this.LYC;
  }

  tick(): void {
    // we don't do anything if the display is switched off
    if (!this.isDisplayOn()) {
      return;
    }

    const modeBefore = this.currentMode;

    // We just draw the image once
    if (this.LY === 144 && this.lineTick === 80) {
      this.lcdCanvasContext.putImageData(this.lcdCanvasData, 0, 0);
    }

    if (this.LY < 144 && this.lineTick < 80) {
      this.currentMode = "Mode2";
    } else if (
      this.LY < 144 &&
      this.lineTick >= 80 &&
      this.lineTick < 172 + 80
    ) {
      // For now we just draw the entire line when we enter mode 3
      if (this.lineTick === 80) {
        this.drawCurrentLine(this.lcdCanvasData);
      }
      this.currentMode = "Mode3";
    } else if (this.LY < 144 && this.lineTick >= 172 + 80) {
      this.currentMode = "Mode0";
    } else if (this.LY >= 144) {
      this.currentMode = "Mode1";
    }

    if (this.LY === this.LYC) {
      this.STAT = this.STAT | 0b100;
    } else {
      this.STAT = this.STAT & 0b11111011;
    }

    // update mode on stat
    switch (this.currentMode) {
      case "Mode0":
        this.STAT = (this.STAT & 0b1111_1100) | 0x0;
        break;
      case "Mode1":
        this.STAT = (this.STAT & 0b1111_1100) | 0x1;
        break;
      case "Mode2":
        this.STAT = (this.STAT & 0b1111_1100) | 0x2;
        break;
      case "Mode3":
        this.STAT = (this.STAT & 0b1111_1100) | 0x3;
        break;
    }

    // Todo: this needs refactroring since the background buffer tile index might
    // change during rendering. We dont' support that at this point.
    if (this.LY === 153 && this.lineTick === this.totalTicksPerLine - 1) {
      this.updateBackgroundPixelBuffer();
      this.updateWindowPixelBuffer();
    }

    let statMode;
    if (this.STAT & 0b1000) {
      statMode = 0;
    } else if (this.STAT & 0b1_0000) {
      statMode = 1;
    } else if (this.STAT & 0b10_0000) {
      statMode = 2;
    }
    if (
      statMode === 0 &&
      this.currentMode === "Mode0" &&
      modeBefore !== "Mode0"
    ) {
      const currentInterruptFlags = this.interrupts.getInterruptFlag();
      this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
    } else if (
      statMode === 1 &&
      this.currentMode === "Mode1" &&
      modeBefore !== "Mode1"
    ) {
      const currentInterruptFlags = this.interrupts.getInterruptFlag();
      this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
    } else if (
      statMode === 2 &&
      this.currentMode === "Mode2" &&
      modeBefore !== "Mode2"
    ) {
      const currentInterruptFlags = this.interrupts.getInterruptFlag();
      this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
    }

    if (this.lineTick === 0) {
      this.checkLyLycInterrupt();
    }

    this.lineTick++;
    this.tickCount++;

    if (this.lineTick >= this.totalTicksPerLine) {
      this.lineTick = 0;
      this.LY = (this.LY + 1) % 154;
    }

    if (this.LY === 144 && this.lineTick === 0) {
      // VBLANK interrupt
      const currentInterruptFlags = this.interrupts.getInterruptFlag();
      this.interrupts.setInterruptFlag(currentInterruptFlags | 0x1);

      ///!!!! Remove this and figure out interrupt routine length
      // this.viewportX = 0; // dirty hack because interrupt timing isn't 100% correct
    }
  }

  checkLyLycInterrupt() {
    if (this.LY === this.LYC && ((this.STAT >> 2) & 0x1) === 0x1) {
      this.STAT = this.STAT | 0b100;
      const currentInterruptFlags = this.interrupts.getInterruptFlag();
      this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
    }
  }

  clearLCD() {
    if (this.isDisplayOn()) {
      this.lcdCanvasContext.fillStyle = "white";
    } else {
      this.lcdCanvasContext.fillStyle = "black";
    }

    this.lcdCanvasContext.fillRect(0, 0, 160, 144);
  }

  drawCurrentLine(lcdCanvasData: ImageData) {
    const line = this.LY;

    ///// Background

    // if (this.LY < 15 && this.viewportX > 0) {
    //     debugger;
    // }

    // We've got all our pixel data in a pixel buffer
    const scrolledLine = (line + this.viewportY) % (32 * 8); // wrap after the 32 tiles
    const backgroundPixels = this.backgroundColorIdBuffer[scrolledLine];
    const enableBackground: boolean = (this.LCDC & 0x1) === 1;
    if (line < 144 && backgroundPixels && enableBackground) {
      for (let x = 0; x < 160; x++) {
        let scrolledX = (x + this.viewportX) % (32 * 8);
        if (backgroundPixels[scrolledX] !== undefined) {
          this.drawPixel(
            lcdCanvasData,
            this.lcdCanvas.width,
            x,
            line,
            this.colors[
              this.backgroundColorPalette[backgroundPixels[scrolledX]]
            ],
          );
        }
      }
    }

    //// Window
    const enableWindow: boolean =
      (this.LCDC & 0x1) === 1 && ((this.LCDC >> 5) & 0x1) === 1;
    if (enableWindow && line >= this.WY) {
      const windowLine = line - this.WY;
      const windowPixels = this.windowColorIdBuffer[windowLine];
      if (line < 144 && windowPixels) {
        for (let x = 0; x < 160; x++) {
          const windowX = x - (this.WX - 7); // +-7?
          if (windowX >= 0 && windowPixels[windowX] !== undefined) {
            this.drawPixel(
              lcdCanvasData,
              this.lcdCanvas.width,
              x,
              line,
              this.colors[this.backgroundColorPalette[windowPixels[windowX]]],
            );
          }
        }
      }
    }

    ///// Objects

    // We can just draw the object pixels on top for now
    // Find the objects we need to draw
    // 4 Bytes per object
    // Byte 0: Y position, 16 is top
    // Byte 1: X position, 8 is right
    // Byte 2: Tile index
    // Byte 3 Attribute flags
    const tileHeight = ((this.LCDC >> 2) & 0x1) === 0 ? 8 : 16;
    for (let i = 0; i < 40 * 4; i = i + 4) {
      const yPostion = this.oam[i];
      const xPosition = this.oam[i + 1];

      if (line >= yPostion - 16 && line < yPostion - 16 + tileHeight) {
        const tileIndex = this.oam[i + 2];
        const attributes = this.oam[i + 3];
        const priority = (attributes >> 7) & 0x1;
        const flipX = (attributes & 0b0010_0000) > 0;
        const flipY = (attributes & 0b0100_0000) > 0;
        const palette =
          ((attributes >> 4) & 0x1) === 0
            ? this.objectColorPalette0
            : this.objectColorPalette1;
        let lineInTile = line - (yPostion - 16);
        if (flipY) {
          lineInTile = tileHeight - 1 - lineInTile;
        }
        // draw the line for the tile
        const lineLeast = this.vram[tileIndex * 16 + lineInTile * 2];
        const lineMost = this.vram[tileIndex * 16 + lineInTile * 2 + 1];
        for (let j = 0; j < 8; j++) {
          const pixelColorId =
            ((lineLeast >> (7 - j)) & 0x1) +
            (((lineMost >> (7 - j)) & 0x1) << 1);
          // don't draw outside of the screen
          if (j < 160 && line < 144 && pixelColorId !== 0) {
            // dont draw transparent pixels
            // double check object color indexing + selected pallete
            const xPos = flipX ? xPosition - 8 + (7 - j) : xPosition - 8 + j;
            // these can exceed the window and draw pixel doesnt fail this yet
            const scrolledX = (xPos + this.viewportX) % (32 * 8);
            const drawOverBackground =
              priority === 0 || backgroundPixels[scrolledX] === 0;
            if (xPos >= 0 && xPos < 160 && drawOverBackground) {
              this.drawPixel(
                lcdCanvasData,
                this.lcdCanvas.width,
                xPos,
                line,
                this.colors[palette[pixelColorId - 1]],
              );
            }
          }
        }
      }
    }

    // for debugging visuals we'll add the pixels of our frame into a buffer and draw it later
    // because of mid frame scrolling, we'll have to do this here
    //  left border line by line
    this.framePixels.push([
      this.getViewportX() % 256,
      (line + this.getViewportY()) % 256,
    ]);
    // right boarder line by line
    this.framePixels.push([
      (this.getViewportX() + 160) % 256,
      (line + this.getViewportY()) % 256,
    ]);
    // top and bottom bars
    if (line === 0 || line === 143) {
      for (let x = 0; x < 160; x++) {
        this.framePixels.push([
          (x + this.getViewportX()) % 256,
          (line + this.getViewportY()) % 256,
        ]);
      }
    }
  }

  updateWindowPixelBuffer() {
    // window should usually have it's own line counter but we'll ignore this for now
    const windowMapArea = (this.LCDC >> 6) & 0x1;
    const mapStart = windowMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
    // data area 0 = 8800–97FF; 1 = 8000–8FFF, keep in mind that 0 points to 0x8000
    const tileAddressingMode = (this.LCDC >> 4) & 0x1;
    const tileDataStart =
      tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;

    // 32x32 tiles
    for (let tileYIndex = 0; tileYIndex < 32; tileYIndex++) {
      for (let tileXIndex = 0; tileXIndex < 32; tileXIndex++) {
        const tileIndex = tileYIndex * 32 + tileXIndex;
        let tileId = this.vram[mapStart + tileIndex]; // 1 byte per tile, 8 pixel height
        if (tileAddressingMode === 0) {
          tileId = signedFrom8Bits(tileId);
        }

        if (tileId != undefined) {
          // 8x8 tiles
          for (let lineInTile = 0; lineInTile < 8; lineInTile++) {
            // 16 bytes per tile, 2 bytes per line
            const lineLeast =
              this.vram[tileDataStart + tileId * 16 + lineInTile * 2];
            const lineMost =
              this.vram[tileDataStart + tileId * 16 + lineInTile * 2 + 1];
            const xOffset = tileXIndex * 8;
            const line = tileYIndex * 8 + lineInTile;
            for (let j = 0; j < 8; j++) {
              const pixelColorId =
                ((lineLeast >> (7 - j)) & 0x1) +
                (((lineMost >> (7 - j)) & 0x1) << 1);
              // double check if they use the same palette
              if (
                this.colors[this.backgroundColorPalette[pixelColorId]] !=
                undefined
              ) {
                if (this.windowColorIdBuffer[line] === undefined) {
                  this.windowColorIdBuffer[line] = [];
                }
                this.windowColorIdBuffer[line][j + xOffset] = pixelColorId;
              }
            }
          }
        }
      }
    }
  }

  updateBackgroundPixelBuffer() {
    const bgMapArea = (this.LCDC >> 3) & 0x1;
    const mapStart = bgMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
    // data area 0 = 8800–97FF; 1 = 8000–8FFF, keep in mind that 0 points to 0x8000
    const tileAddressingMode = (this.LCDC >> 4) & 0x1;
    const tileDataStart =
      tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;

    // 32x32 tiles
    for (let tileYIndex = 0; tileYIndex < 32; tileYIndex++) {
      for (let tileXIndex = 0; tileXIndex < 32; tileXIndex++) {
        const tileIndex = tileYIndex * 32 + tileXIndex;
        let tileId = this.vram[mapStart + tileIndex]; // 1 byte per tile, 8 pixel height
        if (tileAddressingMode === 0) {
          tileId = signedFrom8Bits(tileId);
        }

        if (tileId != undefined) {
          // 8x8 tiles
          for (let lineInTile = 0; lineInTile < 8; lineInTile++) {
            // 16 bytes per tile, 2 bytes per line
            const lineLeast =
              this.vram[tileDataStart + tileId * 16 + lineInTile * 2];
            const lineMost =
              this.vram[tileDataStart + tileId * 16 + lineInTile * 2 + 1];
            const xOffset = tileXIndex * 8;
            const line = tileYIndex * 8 + lineInTile;
            for (let j = 0; j < 8; j++) {
              const pixelColorId =
                ((lineLeast >> (7 - j)) & 0x1) +
                (((lineMost >> (7 - j)) & 0x1) << 1);
              if (
                this.colors[this.backgroundColorPalette[pixelColorId]] !=
                undefined
              ) {
                if (this.backgroundColorIdBuffer[line] === undefined) {
                  this.backgroundColorIdBuffer[line] = [];
                }
                this.backgroundColorIdBuffer[line][j + xOffset] = pixelColorId;
              }
            }
          }
        }
      }
    }

    // does not work yet for some reason
    const backgroundCanvasData = this.backgroundCanvasContext.getImageData(
      0,
      0,
      this.backgroundCanvas.width,
      this.backgroundCanvas.height,
    );
    // debug buffer:
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        if (
          this.backgroundColorIdBuffer != undefined &&
          this.backgroundColorIdBuffer[y] != undefined
        ) {
          const pixelColorId = this.backgroundColorIdBuffer[y][x];
          if (pixelColorId !== undefined) {
            this.drawPixel(
              backgroundCanvasData,
              256,
              x,
              y,
              this.colors[this.backgroundColorPalette[pixelColorId]],
            );
          }
        }
      }
    }

    // add the frame around our background pixel data
    // pixels for frame are filled in draw line since we need to keep track of scrolling
    // (all just done for debugging view)

    const frameColor = [200, 0, 0, 255];
    this.framePixels.forEach((pixel) => {
      // we'll draw it with a 2 px width
      this.drawPixel(backgroundCanvasData, 256, pixel[0], pixel[1], frameColor);
      this.drawPixel(
        backgroundCanvasData,
        256,
        pixel[0] + 1,
        pixel[1],
        frameColor,
      );
      this.drawPixel(
        backgroundCanvasData,
        256,
        pixel[0],
        pixel[1] + 1,
        frameColor,
      );
      this.drawPixel(
        backgroundCanvasData,
        256,
        pixel[0] + 1,
        pixel[1] + 1,
        frameColor,
      );
    });

    this.framePixels = [];

    this.backgroundCanvasContext.putImageData(backgroundCanvasData, 0, 0);
  }

  drawTiles() {
    this.tileCanvasContext.fillStyle = "white";
    this.tileCanvasContext.fillRect(0, 0, 128, 192);

    // 3 x 128 tiles (3 blocks)
    for (let i = 0; i < 3 * 128; i++) {
      this.drawTile(i);
    }

    if (!this.killed) {
      setTimeout(() => this.drawTiles(), 20);
    }
  }

  // Just used for debugging
  drawTile(tileNo: number) {
    const tileCanvasData = this.tileCanvasContext.getImageData(
      0,
      0,
      this.tileCanvas.width,
      this.tileCanvas.height,
    );
    // 16 bytes per tile, 2 bytes per line, first byte least significant, second byte most significant
    for (let line = 0; line < 8; line++) {
      const xOffset = (tileNo % 16) * 8;
      const yOffset = Math.floor(tileNo / 16) * 8;

      const lineLeast = this.vram[2 * line + tileNo * 16];
      const lineMost = this.vram[2 * line + 1 + tileNo * 16];

      for (let i = 0; i < 8; i++) {
        const pixelColorId =
          ((lineLeast >> (7 - i)) & 0x1) + (((lineMost >> (7 - i)) & 0x1) << 1);
        this.drawPixel(
          tileCanvasData,
          this.tileCanvas.width,
          i + xOffset,
          line + yOffset,
          this.colors[pixelColorId],
        );
      }
    }
    this.tileCanvasContext.putImageData(tileCanvasData, 0, 0);
  }

  drawPixel(
    canvasData: ImageData,
    canvasWidth: number,
    x: number,
    y: number,
    color: number[],
  ) {
    var index = (x + y * canvasWidth) * 4;
    canvasData.data[index + 0] = color[0];
    canvasData.data[index + 1] = color[1];
    canvasData.data[index + 2] = color[2];
    canvasData.data[index + 3] = color[3];
  }

  // gameboy resolution is 160x144
  setViewportY(value: number): void {
    this.viewportY = value;
  }

  getViewportY(): number {
    return this.viewportY;
  }

  setViewportX(value: number): void {
    this.viewportX = value;
  }

  getViewportX(): number {
    return this.viewportX;
  }

  setWindowYPosition(value: number): void {
    this.WY = value;
  }

  getWindowYPosition(): number {
    return this.WY;
  }

  setWindowXPosition(value: number): void {
    this.WX = value;
  }

  getWindowXPosition(): number {
    return this.WX;
  }

  setStatusRegister(value: number): void {
    this.STAT = value & 0xff;
    const currentInterruptFlags = this.interrupts.getInterruptFlag();
    this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
  }

  getStatusRegister(): number {
    return this.STAT;
  }

  getLCDControlerRegister(): number {
    return this.LCDC & 0xff;
  }

  isDisplayOn(): boolean {
    return ((this.LCDC >> 7) & 1) === 1;
  }

  setLCDControlerRegister(value: number): void {
    if (((this.LCDC >> 7) & 1) === 1 && ((value >> 7) & 1) === 0) {
      // display switched off
      this.currentMode = "Mode0";
      this.LY = 0;
      this.lineTick = 0;
      this.STAT = this.STAT & 0b1111_1100;
      this.LCDC = this.LCDC & 0b1111_1100;
    }

    if (((this.LCDC >> 7) & 1) === 0 && ((value >> 7) & 1) === 1) {
      // display switched on
      this.checkLyLycInterrupt();
    }

    if ((value >> 4) & 0x1) {
    } else {
    }
    this.LCDC = value & 0xff;
  }

  setBackgroundColorPalette(value: number): void {
    this.ff47 = value & 0xff;
    const colorId0 = value & 0x03;
    const colorId1 = (value >> 2) & 0x03;
    const colorId2 = (value >> 4) & 0x03;
    const colorId3 = (value >> 6) & 0x03;
    this.backgroundColorPalette = [colorId0, colorId1, colorId2, colorId3];
  }

  getBackgroundColorPalette(): number {
    return this.ff47;
  }

  setObjectColorPalette0(value: number): void {
    this.ff48 = value;
    // color 0 reserved for transparent
    const colorId1 = (value >> 2) & 0x03;
    const colorId2 = (value >> 4) & 0x03;
    const colorId3 = (value >> 6) & 0x03;
    this.objectColorPalette0 = [colorId1, colorId2, colorId3];
  }

  getObjectColorPalette0(): number {
    return this.ff48;
  }

  setObjectColorPalette1(value: number): void {
    this.ff49 = value;
    // color 0 reserved for transparent
    const colorId1 = (value >> 2) & 0x03;
    const colorId2 = (value >> 4) & 0x03;
    const colorId3 = (value >> 6) & 0x03;
    this.objectColorPalette1 = [colorId1, colorId2, colorId3];
  }

  getObjectColorPalette1(): number {
    return this.ff49;
  }

  getLCDY(): number {
    return this.LY;
  }

  writeVram(address: number, value: number): void {
    // Return if we're in mode 3 and the diplay is on
    if (this.currentMode === "Mode3" && ((this.LCDC >> 7) & 1) === 0x1) {
      return;
    }

    if (address > 8191) {
      throw new Error(
        `attempt to write outside of vram, address: ${toHexString(address)}, value: ${toHexString(value)}`,
      );
    }
    this.vram[address] = value & 0xff;
  }

  readVram(address: number) {
    if (address > 8191) {
      throw new Error(
        `attempt to read outside of vram, address: ${toHexString(address)}`,
      );
    }
    return this.vram[address];
  }

  writeOAM(address: number, value: number): void {
    if (address > 159) {
      throw new Error(
        `attempt to write outside of oam, address: ${toHexString(address)}, value: ${toHexString(value)}`,
      );
    }
    this.oam[address] = value & 0xff;
  }

  readOAM(address: number): number {
    if (address > 159) {
      throw new Error(
        `attempt to read outside of oam, address: ${toHexString(address)}}`,
      );
    }
    return this.oam[address];
  }

  kill() {
    this.killed = true;
  }

  /**
   * Called once we enter debugging mode, feel free to log whatever you need here.
   */
  logDebugInfo(): void {
    // const tileAddressingMode = (this.LCDC >> 4) & 0x1;
    // const tileDataStart =
    //   tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;
    // // bg map area 0 = 9800–9BFF; 1 = 9C00–9FFF
    // const bgMapArea = (this.LCDC >> 3) & 0x1;
    // const mapStart = bgMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
    // const tileIds: string[][] = [];
    // for (let line = 0; line < 144; line += 8) {
    //   for (let tileNo = 0; tileNo < 32; tileNo++) {
    //     const tileIndex = Math.floor(line / 8) * 32 + tileNo;
    //     let tileId = this.vram[mapStart + tileIndex]; // 1 byte per tile, 8 pixel height
    //     if (!tileIds[line / 8]) {
    //       tileIds[line / 8] = [];
    //     }
    //     tileIds[line / 8][tileNo] = toHexString(tileId);
    //   }
    // }
    // console.log("vram background tiles");
    // console.log(tileIds);
    // const tileHeight = 8;
    // const objectPositions: string[] = [];
    // for (let i = 0; i < 40 * 4; i = i + 4) {
    //   const yPostion = this.oam[i];
    //   const xPostion = this.oam[i + 1];
    //   const tileIndex = this.oam[i + 2];
    //   objectPositions.push(
    //     yPostion + ":" + xPostion + "=>" + toHexString(tileIndex),
    //   );
    // }
    // console.log("background buffer");
    // console.log("object positions");
    // console.log(objectPositions);
  }
}
