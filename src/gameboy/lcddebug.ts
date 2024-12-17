import { signedFrom8Bits } from "./utils";
import { RGBA, LcdUtils } from "./lcdutils";

export type PPUInfoForDebugger = {
  LCDC_ff40: number;
  SCY_ff42: number;
  SCX_ff43: number;
  BGP_ff47: number; // BGP BG pallette data
  OBP0_ff48: number; // OBP0, lower two bits ignored, color index 0 is transparent
  OBP1_ff49: number; // OBP1, lower two bits ignored, color index 0 is transparent
  WY_ff4a: number; // Window Y
  WX_ff4b: number; // Window X
};

export class LcdDebugRenderer {
  private backgroundColorPalette: RGBA;

  // For background debug
  private currentLineInBackground = 0; // 0 - 255
  private currentTileInLine = 0; // from 0 - 31

  private backgroundImageData: ImageData;
  private backgroundCanvasContext: CanvasRenderingContext2D;

  // In order to avoid overrides we're keeping track of where we put a border.
  private scrollBorderPositions: boolean[][] = [];

  // For tile debug
  private currentTileInTileView = 0;
  private currentLineInTile = 0;

  private tileViewImageData: ImageData;
  private tileViewCanvasContext: CanvasRenderingContext2D;

  private colors: RGBA[] = [
    [174, 255, 255, 255],
    [21, 205, 214, 255],
    [16, 173, 173, 255],
    [76, 17, 18, 255],
  ];

  constructor(
    tileCanvas: HTMLCanvasElement,
    backgroundCanvas: HTMLCanvasElement,
    private vram: number[],
    private getPPUInfo: () => PPUInfoForDebugger,
  ) {
    this.backgroundCanvasContext = backgroundCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    this.backgroundImageData = this.backgroundCanvasContext.getImageData(
      0,
      0,
      backgroundCanvas.width,
      backgroundCanvas.height,
    );

    this.tileViewCanvasContext = tileCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    this.tileViewImageData = this.tileViewCanvasContext.getImageData(0, 0, tileCanvas.width, tileCanvas.height);

    this.backgroundColorPalette = this.getBackgroundColorPalette();
  }

  // We'll render the tiles and the background within
  // the 144 * (80 + 172) dots = 36288 = lines * dots for mode 2 + mode 3.
  // Just so that we don't block too much time for debug rendering.
  // We've got 32*32 = 1024 background tiles picked from a total number
  // of 384 tiles. That gives us approx 36288 / (1024 + 384) = 25 dots per tile.
  // So we can easily render one tile line at a time.
  tick() {
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
  }

  resetForNextFrame() {
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
  }

  private getBackgroundColorPalette(): RGBA {
    const bgColorId0 = this.getPPUInfo().BGP_ff47 & 0x03;
    const bgColorId1 = (this.getPPUInfo().BGP_ff47 >> 2) & 0x03;
    const bgColorId2 = (this.getPPUInfo().BGP_ff47 >> 4) & 0x03;
    const bgColorId3 = (this.getPPUInfo().BGP_ff47 >> 6) & 0x03;
    return [bgColorId0, bgColorId1, bgColorId2, bgColorId3];
  }

  private renderCurrentTileLineForBackgroundView() {
    // data area 0 = 8800–97FF; 1 = 8000–8FFF, keep in mind that 0 points to 0x8000
    const bgMapArea = (this.getPPUInfo().LCDC_ff40 >> 3) & 0x1;
    const tileMapStart = bgMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;
    const tileAddressingMode = (this.getPPUInfo().LCDC_ff40 >> 4) & 0x1;
    const tileDataStart = tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;

    // identify the tile number
    // tile map contains tile index (tile maps are 32x32)
    const mapIndex =
      tileMapStart + Math.floor(this.currentLineInBackground / 8) * 32 + Math.floor(this.currentTileInLine);
    let currentTileIndex = this.vram[mapIndex];
    if (tileAddressingMode === 0) {
      currentTileIndex = signedFrom8Bits(currentTileIndex);
    }

    const currentLineInTile = this.currentLineInBackground % 8;
    const currentTileDataLow = this.vram[tileDataStart + currentTileIndex * 16 + currentLineInTile * 2];
    const currentTileDataHigh = this.vram[tileDataStart + currentTileIndex * 16 + currentLineInTile * 2 + 1];

    for (let i = 7; i >= 0; i--) {
      const color =
        this.colors[
          this.backgroundColorPalette[(((currentTileDataHigh >> i) & 0x1) << 1) | ((currentTileDataLow >> i) & 0x1)]
        ];

      const x = this.currentTileInLine * 8 + (7 - i);
      const y = this.currentLineInBackground;

      // Don't draw over the border
      if (!this.scrollBorderPositions[x] || !this.scrollBorderPositions[x][y]) {
        LcdUtils.drawPixel(this.backgroundImageData, 256, x, y, color);
      }
    }
  }

  public drawScrollBorderPixel(x: number, y: number) {
    const red: RGBA = [255, 0, 0, 255];
    LcdUtils.drawPixel(this.backgroundImageData, 256, x, y, red);
    LcdUtils.drawPixel(this.backgroundImageData, 256, Math.min(255, x + 1), y, red);
    LcdUtils.drawPixel(this.backgroundImageData, 256, x, Math.min(255, y + 1), red);
    LcdUtils.drawPixel(this.backgroundImageData, 256, Math.min(255, x + 1), Math.min(255, y + 1), red);

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
  }

  renderCurrentTileLineForTileView() {
    const currentTileDataLow = this.vram[this.currentTileInTileView * 16 + this.currentLineInTile * 2];
    const currentTileDataHigh = this.vram[this.currentTileInTileView * 16 + this.currentLineInTile * 2 + 1];

    for (let i = 7; i >= 0; i--) {
      const color =
        this.colors[
          this.backgroundColorPalette[(((currentTileDataHigh >> i) & 0x1) << 1) | ((currentTileDataLow >> i) & 0x1)]
        ];

      const x = Math.floor(this.currentTileInTileView % 16) * 8 + (7 - i);
      const y = Math.floor(this.currentTileInTileView / 16) * 8 + this.currentLineInTile;

      LcdUtils.drawPixel(this.tileViewImageData, 128, x, y, color);
    }
  }

  private isBackgroundDone(): boolean {
    // we've got 256 background tiles
    return this.currentLineInBackground > 255;
  }

  private isTileViewDone(): boolean {
    // we've got 384 tiles in the buffer
    return this.currentTileInTileView > 383;
  }
}
