import { Interrupts } from "./interrupts";
import { signedFrom8Bits } from "./utils";
import { LcdDebugRenderer } from "./lcddebug";
import { LcdUtils, RGBA } from "./lcdutils";

export interface PPU {
  writeFF42(value: number): void;
  writeFF43(value: number): void;
  readFF42(): number;
  readFF43(): number;
  writeFF4A(value: number): void;
  readFF4A(): number;
  writeFF4B(value: number): void;
  readFF4B(): number;
  writeFF41(value: number): void;
  readFF41(): number;
  readFF40(): number;
  writeFF40(value: number): void;
  writeFF47(value: number): void;
  readFF47(): number;
  writeFF48(value: number): void;
  writeFF49(value: number): void;
  readFF48(): number;
  readFF49(): number;
  writeVram(address: number, value: number): void;
  readVram(address: number): number;
  writeOAM(address: number, value: number): void;
  readOAM(address: number): number;
  readFF44(): number;
  writeFF45(value: number): void;
  readFF45(): number;
  tick(): void;
  logDebugInfo(): void;
}

type BackgroundWindowPixel = {
  colorIndex: number;
  // The following values are used to overwrite background pixels
  // with sprite pixels since we're merging sprites into the background fifo.
  // That's a bit of a hack to keep things simple.
  overwrittenBySprite?: boolean;
  palette?: number;
};

type SpritePixel = {
  colorIndex: number;
  palette: number; // can be 0 or 1
  backgroundPriority: number;
};

type PixelFetcherStepName = "Get tile index" | "Get tile data low" | "Get tile data high" | "Sleep" | "Push";

type PixelFetcherStep = {
  name: PixelFetcherStepName;
  dotCount: number;
};

type SpriteFetcherStepName = "Get tile index" | "Get tile data low" | "Get tile data high" | "Push";

type SpriteFetcherStep = {
  name: SpriteFetcherStepName;
  dotCount: number;
};

type OAMEntry = {
  yPosition: number;
  xPosition: number;
  tileIndex: number;
  attributes: number;
};

type PPUInfoForPixelFetcher = {
  LCDC_ff40: number;
  SCY_ff42: number;
  SCX_ff43: number;
  BGP_ff47: number; // BGP BG pallette data
  OBP0_ff48: number; // OBP0, lower two bits ignored, color index 0 is transparent
  OBP1_ff49: number; // OBP1, lower two bits ignored, color index 0 is transparent
  WY_ff4a: number; // Window Y
  WX_ff4b: number; // Window X
  objectsForScanline: OAMEntry[];
  debugEnabled: boolean;
};

class SpritePixelFetcher {
  private spriteFifo: SpritePixel[] = [];
  private currentSprite: OAMEntry | undefined;
  private fetchingCompleted = false;
  private currentTileDataLow = 0x0;
  private currentTileDataHigh = 0x0;
  private currentLine = 0;
  // We still keep track of the tile index because for flipped 8x16 tiles we'll have to process the second tile first
  private currentTileIndex = 0;

  private steps: SpriteFetcherStep[] = [
    { name: "Get tile index", dotCount: 2 },
    { name: "Get tile data low", dotCount: 2 },
    { name: "Get tile data high", dotCount: 2 },
    { name: "Push", dotCount: 1 },
  ];

  // To keep track where we are in the step
  private currentStepIndex = 0;
  private currentDotForStep = 0;

  constructor(
    private vram: number[],
    private getPPUInfo: () => PPUInfoForPixelFetcher,
  ) {}

  tick() {
    if (!this.currentSprite) {
      // We don't do anything if we haven't actually started loading a sprite.
      return;
    }

    const currentStep = this.steps[this.currentStepIndex];

    if (currentStep.name === "Get tile index" && this.currentDotForStep === 0) {
      const flipY = (this.currentSprite.attributes & 0b0100_0000) > 0;
      const tileHeight = ((this.getPPUInfo().LCDC_ff40 >> 2) & 0x1) === 0 ? 8 : 16;

      if (tileHeight === 16) {
        this.currentSprite.tileIndex = this.currentSprite.tileIndex & 0b1111_1110;
      }
      // For flipped 8x16 tiles start off with the second tile
      this.currentTileIndex =
        flipY && tileHeight === 16 ? this.currentSprite.tileIndex + 1 : this.currentSprite.tileIndex;
    } else if (currentStep.name === "Get tile data low" && this.currentDotForStep === 0) {
      const flipY = (this.currentSprite.attributes & 0b0100_0000) > 0;
      let lineInTile = this.currentLine - (this.currentSprite.yPosition - 16);
      if (flipY) {
        lineInTile = 7 - lineInTile;
      }
      this.currentTileDataLow = this.vram[this.currentTileIndex * 16 + lineInTile * 2];
    } else if (currentStep.name === "Get tile data high" && this.currentDotForStep === 0) {
      const flipY = (this.currentSprite.attributes & 0b0100_0000) > 0;
      let lineInTile = this.currentLine - (this.currentSprite.yPosition - 16);
      if (flipY) {
        lineInTile = 7 - lineInTile;
      }
      this.currentTileDataHigh = this.vram[this.currentTileIndex * 16 + lineInTile * 2 + 1];
    } else if (currentStep.name === "Push") {
      const color0 = (((this.currentTileDataHigh >> 7) & 0x1) << 1) | ((this.currentTileDataLow >> 7) & 0x1);
      const color1 = (((this.currentTileDataHigh >> 6) & 0x1) << 1) | ((this.currentTileDataLow >> 6) & 0x1);
      const color2 = (((this.currentTileDataHigh >> 5) & 0x1) << 1) | ((this.currentTileDataLow >> 5) & 0x1);
      const color3 = (((this.currentTileDataHigh >> 4) & 0x1) << 1) | ((this.currentTileDataLow >> 4) & 0x1);
      const color4 = (((this.currentTileDataHigh >> 3) & 0x1) << 1) | ((this.currentTileDataLow >> 3) & 0x1);
      const color5 = (((this.currentTileDataHigh >> 2) & 0x1) << 1) | ((this.currentTileDataLow >> 2) & 0x1);
      const color6 = (((this.currentTileDataHigh >> 1) & 0x1) << 1) | ((this.currentTileDataLow >> 1) & 0x1);
      const color7 = (((this.currentTileDataHigh >> 0) & 0x1) << 1) | ((this.currentTileDataLow >> 0) & 0x1);

      // Palette is 0 or 1
      const palette = (this.currentSprite.attributes >> 4) & 0x1;
      const backgroundPriority = (this.currentSprite.attributes >> 7) & 0x1;

      let tmpPixels: SpritePixel[] = [
        { colorIndex: color0, palette, backgroundPriority },
        { colorIndex: color1, palette, backgroundPriority },
        { colorIndex: color2, palette, backgroundPriority },
        { colorIndex: color3, palette, backgroundPriority },
        { colorIndex: color4, palette, backgroundPriority },
        { colorIndex: color5, palette, backgroundPriority },
        { colorIndex: color6, palette, backgroundPriority },
        { colorIndex: color7, palette, backgroundPriority },
      ];

      const flipX = (this.currentSprite.attributes & 0b0010_0000) > 0;
      if (flipX) {
        tmpPixels = tmpPixels.reverse();
      }

      // if the sprite is too far on the left, we might have to drop a few pixels
      if (this.currentSprite.xPosition < 8) {
        tmpPixels = tmpPixels.splice(8 - this.currentSprite.xPosition);
      }

      this.spriteFifo.push(...tmpPixels);

      this.fetchingCompleted = true;
    }

    // Move on to next step
    this.currentDotForStep++;
    if (this.currentDotForStep === currentStep.dotCount) {
      this.currentStepIndex++;
      this.currentDotForStep = 0;
    }
  }

  // Don't call this function without checking first that there is a sprite available
  startSpriteFetch(xPosition: number, currentLine: number) {
    this.spriteFifo.length = 0;
    this.currentLine = currentLine;
    this.fetchingCompleted = false;
    this.currentStepIndex = 0;
    this.currentDotForStep = 0;
    const objectsForLine = this.getPPUInfo().objectsForScanline;

    // Pick the first sprite that matches the x coordinate and remove it from our list
    for (let i = 0; i < objectsForLine.length; i++) {
      if (objectsForLine[i].xPosition - 8 <= xPosition) {
        this.currentSprite = objectsForLine[i];
        // remove the element from the list so that we don't render it again
        objectsForLine.splice(i, 1);
        break;
      }
    }
  }

  getFifo(): SpritePixel[] {
    return this.spriteFifo;
  }

  spriteFetchCompleted(): boolean {
    return this.fetchingCompleted;
  }

  hasSpriteForXIndex(xIndex: number): boolean {
    const objectsForScanline = this.getPPUInfo().objectsForScanline;
    const sprite = objectsForScanline.find((o) => o.xPosition - 8 <= xIndex);
    return sprite !== undefined;
  }
}

// Great explanation https://hacktix.github.io/GBEDG/ppu/
class BackgroundWindowPixelFetcher {
  // pixels are only pushed the fifo is empty
  private backgroundWindowFifo: BackgroundWindowPixel[] = [];

  private steps: PixelFetcherStep[] = [
    { name: "Get tile index", dotCount: 2 },
    { name: "Get tile data low", dotCount: 2 },
    { name: "Get tile data high", dotCount: 2 },
    { name: "Sleep", dotCount: 2 },
    { name: "Push", dotCount: 1 }, // I think this needs just a single dot but the fifo has to be empty for it to work
  ];

  // To keep track where we are in the step
  private currentStepIndex = 0;
  private currentDotForStep = 0;

  // Y
  private currentLineIndex = 0;
  // X
  private currentXIndex = 0;

  // Data we're updating as we fetch
  private currentTileIndex = 0;
  private currentLineInTile = 0;
  private currentTileDataLow = 0x0;
  private currentTileDataHigh = 0x0;
  private currentScrollY = 0;
  private currentScrollX = 0;
  private currentWindowLine = 0;

  // Once we hit a window coordinate, this flag will get flipped and we'll just render the window from now on.
  private renderingWindow = false;

  // We clear the background buffer when switching to window mode which might accidentally
  // remove object pixels. We keep a backup of the object pixels and merge them back into
  // the window buffer.
  private objectPixelBackup: (BackgroundWindowPixel | null)[] = [];

  /**
   *
   * @param vram
   */
  constructor(
    private vram: number[],
    private getPPUInfo: () => PPUInfoForPixelFetcher,
  ) {}

  reset(toLine: number, scxAtBeginningOfScanLine: number) {
    this.backgroundWindowFifo.length = 0;
    this.currentXIndex = 0;
    this.currentScrollX = scxAtBeginningOfScanLine;
    this.currentLineIndex = toLine;
    this.currentStepIndex = 0;
    this.currentDotForStep = 0;

    const isNewFrame = toLine === 0;
    if (isNewFrame) {
      this.currentWindowLine = 0;
    } else {
      // For simplicity we assume that we're moving line by line;
      // if we were rendering the window before, we have to got to the next window line
      if (this.renderingWindow) {
        this.currentWindowLine++;
      }
    }

    this.renderingWindow = false;
  }

  // Process:
  // We have to fetch the background tile number (or window tile number if we have already hit the window).
  // Once we entered the window region we empty the buffer and start rendering window pixels until the end.
  // We only push pixels if the buffer is empty. Every tick, one pixel gets consumed, so we usually have to
  // restart the push step twice.
  // This class needs to actively shift pixels out so that it can stop shifting out once we have reached the window
  // Each tile contains 16 bits, 8 bit low followed by 8 bit high
  tick() {
    const currentStep = this.steps[this.currentStepIndex];
    let pushStepDone = false;

    const tileAddressingMode = (this.getPPUInfo().LCDC_ff40 >> 4) & 0x1;
    const tileDataStart = tileAddressingMode === 0 ? 0x9000 - 0x8000 : 0x8000 - 0x8000;

    if (currentStep.name === "Get tile index") {
      // Look up tile for window
      if (this.renderingWindow) {
        this.lookupWindowTile(tileAddressingMode);
      } else {
        this.lookupBackgroundTile(tileAddressingMode);
      }

      // Check for step name and dot count in every step so that we don't run computations twice.
      // Get Tile Data Next
    } else if (currentStep.name === "Get tile data low" && this.currentDotForStep === 0) {
      this.currentTileDataLow = this.vram[tileDataStart + this.currentTileIndex * 16 + this.currentLineInTile * 2];
    } else if (currentStep.name === "Get tile data high" && this.currentDotForStep === 0) {
      this.currentTileDataHigh = this.vram[tileDataStart + this.currentTileIndex * 16 + this.currentLineInTile * 2 + 1];
    } else if (currentStep.name === "Sleep") {
      // do nothing
    } else if (currentStep.name === "Push") {
      const color0 = (((this.currentTileDataHigh >> 7) & 0x1) << 1) | ((this.currentTileDataLow >> 7) & 0x1);
      const color1 = (((this.currentTileDataHigh >> 6) & 0x1) << 1) | ((this.currentTileDataLow >> 6) & 0x1);
      const color2 = (((this.currentTileDataHigh >> 5) & 0x1) << 1) | ((this.currentTileDataLow >> 5) & 0x1);
      const color3 = (((this.currentTileDataHigh >> 4) & 0x1) << 1) | ((this.currentTileDataLow >> 4) & 0x1);
      const color4 = (((this.currentTileDataHigh >> 3) & 0x1) << 1) | ((this.currentTileDataLow >> 3) & 0x1);
      const color5 = (((this.currentTileDataHigh >> 2) & 0x1) << 1) | ((this.currentTileDataLow >> 2) & 0x1);
      const color6 = (((this.currentTileDataHigh >> 1) & 0x1) << 1) | ((this.currentTileDataLow >> 1) & 0x1);
      const color7 = (((this.currentTileDataHigh >> 0) & 0x1) << 1) | ((this.currentTileDataLow >> 0) & 0x1);

      const tmpPixels: BackgroundWindowPixel[] = [
        { colorIndex: color0 },
        { colorIndex: color1 },
        { colorIndex: color2 },
        { colorIndex: color3 },
        { colorIndex: color4 },
        { colorIndex: color5 },
        { colorIndex: color6 },
        { colorIndex: color7 },
      ];

      // Maybe merge already fetched objects back into the window fifo.
      // Todo: in theory, we'd have to double check the object priority for the new
      // window value but this is so unlikely that I can't be bothered :)
      if (this.isFetchingWindow() && this.objectPixelBackup.length > 0) {
        for (let i = 0; i < tmpPixels.length; i++) {
          const entry = this.objectPixelBackup.shift();
          if (entry != null) {
            tmpPixels[i] = entry;
          }
        }
      }

      if (this.backgroundWindowFifo.length <= this.minElementsInBackgroundFifo) {
        this.backgroundWindowFifo.push(...tmpPixels);
        pushStepDone = true;

        this.currentXIndex = this.currentXIndex + 8;
      }
    }

    // Maybe move on to next step
    this.currentDotForStep++;
    if (this.currentDotForStep === currentStep.dotCount && currentStep.name !== "Push") {
      this.currentStepIndex++;
      this.currentDotForStep = 0;
    } else if (currentStep.name === "Push" && pushStepDone) {
      this.currentStepIndex = 0;
      this.currentDotForStep = 0;
    }
  }

  getCurrentStep(): PixelFetcherStep {
    return this.steps[this.currentStepIndex];
  }

  private lookupWindowTile(tileAddressingMode: number) {
    const windowMapArea = (this.getPPUInfo().LCDC_ff40 >> 6) & 0x1;
    const mapStart = windowMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;

    // we're in one of 32x32 tiles
    const pointerToTileIndex = Math.floor(this.currentWindowLine / 8) * 32 + Math.floor(this.currentXIndex / 8);
    this.currentTileIndex = this.vram[mapStart + pointerToTileIndex];

    this.currentLineInTile = this.currentWindowLine % 8;

    if (tileAddressingMode === 0) {
      this.currentTileIndex = signedFrom8Bits(this.currentTileIndex);
    }
  }

  private lookupBackgroundTile(tileAddressingMode: number) {
    // data area 0 = 8800–97FF; 1 = 8000–8FFF, keep in mind that 0 points to 0x8000
    const bgMapArea = (this.getPPUInfo().LCDC_ff40 >> 3) & 0x1;
    const tileMapStart = bgMapArea === 0 ? 0x9800 - 0x8000 : 0x9c00 - 0x8000;

    // Scrolling is read on tile fetch
    this.currentScrollY = this.getPPUInfo().SCY_ff42;

    // we just started a new line after a reset
    this.currentScrollX = (this.currentScrollX & 0b111) | (this.getPPUInfo().SCX_ff43 & 0b1111_1000);

    // identify the tile number
    // tile map contains tile index (tile maps are 32x32)
    const mapIndex =
      tileMapStart +
      Math.floor(((this.currentLineIndex + this.currentScrollY) % 256) / 8) * 32 +
      Math.floor(((this.currentXIndex + this.currentScrollX) % 256) / 8);
    this.currentTileIndex = this.vram[mapIndex];
    if (tileAddressingMode === 0) {
      this.currentTileIndex = signedFrom8Bits(this.currentTileIndex);
    }
    this.currentLineInTile = (this.currentLineIndex + this.currentScrollY) % 8;
  }

  getFifo(): BackgroundWindowPixel[] {
    return this.backgroundWindowFifo;
  }

  getCurrentScrollX(): number {
    return this.currentScrollX;
  }

  isFetchingWindow(): boolean {
    return this.renderingWindow;
  }

  switchToWindowRendering() {
    // There's a tricky edge case where we've already merged some object data into our fifo.
    // So before clearing it, we'll keep a copy of this buffer and just merge it back in.
    this.objectPixelBackup = [];
    this.backgroundWindowFifo.forEach((entry) => {
      if (entry.overwrittenBySprite) {
        this.objectPixelBackup.push(entry);
      } else {
        this.objectPixelBackup.push(null);
      }
    });
    this.backgroundWindowFifo.length = 0;
    this.renderingWindow = true;
    this.currentXIndex = 0;
    this.currentStepIndex = 0;
    this.currentDotForStep = 0;
  }

  // We need at least 8 elements for object merging at any time
  private minElementsInBackgroundFifo = 8;
}

class RenderPipeline {
  // Toy blue
  private colors: RGBA[] = [
    [174, 255, 255, 255],
    [21, 205, 214, 255],
    [16, 173, 173, 255],
    [76, 17, 18, 255],
  ];

  private pixelsSentToLCDForCurrentLine = 0;
  private isStartOfScanline = true;
  private discardPixelsCount = 0;
  private waitingForSpriteFetch = false;
  private currentLine = 0;

  /**
   *
   * @param vram
   * @param sendToLCD Called for each pixel, so 160x144 times
   */
  constructor(
    private backgroundPixelFetcher: BackgroundWindowPixelFetcher,
    private spritePixelFetcher: SpritePixelFetcher,
    private getPPUInfo: () => PPUInfoForPixelFetcher,
    private sendToLCD: (color: RGBA) => void,
    private lcdDebugRenderer: LcdDebugRenderer,
  ) {}

  tick() {
    // check for objects
    // in the beginning of a line we might have to wait until the background
    // buffer got filled up
    // Not sure if this is the right behavior but we'll let the buffer fill up first

    // Check if we need to flip to window rendering
    const windowEnabled = ((this.getPPUInfo().LCDC_ff40 >> 5) & 0x1) === 1;
    if (
      windowEnabled &&
      this.currentLine >= this.getPPUInfo().WY_ff4a &&
      // position is defined as + 7, https://gbdev.io/pandocs/Scrolling.html#ff4aff4b--wy-wx-window-y-position-x-position-plus-7
      this.pixelsSentToLCDForCurrentLine >= this.getPPUInfo().WX_ff4b - 7 &&
      !this.backgroundPixelFetcher.isFetchingWindow()
    ) {
      this.backgroundPixelFetcher.switchToWindowRendering();
    }

    if (this.isStartOfScanline) {
      // The background fetcher reads the scroll x repeatedly
      // but only updates the last 3 bit as part of the first fetch.
      // but only if we're not rendering the window
      if (!this.backgroundPixelFetcher.isFetchingWindow()) {
        this.discardPixelsCount = this.backgroundPixelFetcher.getCurrentScrollX() % 8;
      } else if (this.getPPUInfo().WX_ff4b < 7 && this.backgroundPixelFetcher.isFetchingWindow()) {
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
        for (let i = 0; i < this.discardPixelsCount; i++) {
          this.backgroundPixelFetcher.getFifo().shift();
          this.discardPixelsCount--;
        }
      }

      return;
    }

    if (
      this.backgroundPixelFetcher.getFifo().length >= this.minElementsInBackgroundFifo &&
      this.spritePixelFetcher.hasSpriteForXIndex(this.pixelsSentToLCDForCurrentLine) &&
      !this.waitingForSpriteFetch
    ) {
      this.waitingForSpriteFetch = true;
      this.spritePixelFetcher.startSpriteFetch(this.pixelsSentToLCDForCurrentLine, this.currentLine);
    }

    if (this.waitingForSpriteFetch) {
      if (this.spritePixelFetcher.spriteFetchCompleted()) {
        this.waitingForSpriteFetch = false;
        // Merge sprite into background buffer if objects are still enabled
        const objectsEnabled = ((this.getPPUInfo().LCDC_ff40 >> 1) & 0x1) === 1;
        if (objectsEnabled) {
          this.mergeSpriteIntoBackground();
        }

        // We return early here since there might be another sprite coming
        return;
      } else {
        // We need to wait for sprite fetch completion
        this.spritePixelFetcher.tick();
        return;
      }
    }

    // Fetch
    // It's a bit tough to simulate this simultaneous catching and sending
    // done in hardware so we'll just keep track of whether a push
    // was possible before the sending a pixel to the LCD and if not
    // we'll just try again.
    let backgroundCatcherShouldPush = true;
    const fifoSizeBeforeTick = this.backgroundPixelFetcher.getFifo().length;
    this.backgroundPixelFetcher.tick();
    if (
      this.backgroundPixelFetcher.getFifo().length > fifoSizeBeforeTick ||
      this.backgroundPixelFetcher.getCurrentStep().name !== "Push" // we don't try again if the fifo wasn't even trying to push
    ) {
      backgroundCatcherShouldPush = false;
    }

    // Send
    this.maybeSendPixelInFifoToLCD();

    // Fetch
    if (backgroundCatcherShouldPush) {
      this.backgroundPixelFetcher.tick();
    }
  }

  mergeSpriteIntoBackground() {
    const spriteFifo = this.spritePixelFetcher.getFifo();
    const backgroundFifo = this.backgroundPixelFetcher.getFifo();
    // if the sprites are one the left side of the screen the sprite fifo might be a bit shorter
    for (let i = 0; i < spriteFifo.length; i++) {
      // 3 conditions:
      // 1. We don't overwrite pixels that have already been overwritten by an earlier sprite
      // 2. We don't overwrite if the sprite pixel is transparent
      // 3. If the sprite priority is 1, then bg/windows colors 1-3 are written over this object
      if (
        !backgroundFifo[i].overwrittenBySprite &&
        spriteFifo[i].colorIndex > 0 &&
        (spriteFifo[i].backgroundPriority === 0 || backgroundFifo[i].colorIndex === 0)
      ) {
        backgroundFifo[i] = {
          colorIndex: spriteFifo[i].colorIndex,
          palette: spriteFifo[i].palette,
          overwrittenBySprite: true,
        };
      }
    }
  }

  reset(toLine: number, scxAtBeginningOfScanLine: number) {
    this.currentLine = toLine;
    this.isStartOfScanline = true;
    this.backgroundPixelFetcher.reset(toLine, scxAtBeginningOfScanLine);
  }

  // We need at least 8 elements for object merging at any time
  private minElementsInBackgroundFifo = 8;

  private maybeSendPixelInFifoToLCD() {
    if (this.backgroundPixelFetcher.getFifo().length <= this.minElementsInBackgroundFifo) {
      // We don't have enough pixels yet
      return;
    }

    if (this.backgroundPixelFetcher.getFifo().length > this.minElementsInBackgroundFifo) {
      const pixel = this.backgroundPixelFetcher.getFifo().shift();
      // discard pixels we don't need
      if (this.discardPixelsCount > 0) {
        this.discardPixelsCount--;
        return;
      }

      const ppuInfo = this.getPPUInfo();

      // if this is a background pixel and the background isn't enabled then we just sent out a white pixel
      if (!pixel?.overwrittenBySprite && (ppuInfo.LCDC_ff40 & 0x1) === 0) {
        this.sendToLCD(this.colors[0]);
      } else if (pixel?.overwrittenBySprite === true) {
        const obj0ColorId0 = 0; // lower 2 bits ignored for objects, it's transparent for object
        const obj0ColorId1 = (ppuInfo.OBP0_ff48 >> 2) & 0x03;
        const obj0ColorId2 = (ppuInfo.OBP0_ff48 >> 4) & 0x03;
        const obj0ColorId3 = (ppuInfo.OBP0_ff48 >> 6) & 0x03;
        const obj0ColorPalette = [obj0ColorId0, obj0ColorId1, obj0ColorId2, obj0ColorId3];

        const obj1ColorId0 = 0; // lower 2 bits ignored for objects, it's transparent for objects
        const obj1ColorId1 = (ppuInfo.OBP1_ff49 >> 2) & 0x03;
        const obj1ColorId2 = (ppuInfo.OBP1_ff49 >> 4) & 0x03;
        const obj1ColorId3 = (ppuInfo.OBP1_ff49 >> 6) & 0x03;
        const obj1ColorPalette = [obj1ColorId0, obj1ColorId1, obj1ColorId2, obj1ColorId3];

        const objPalette = pixel.palette === 0 ? obj0ColorPalette : obj1ColorPalette;

        this.sendToLCD(this.colors[objPalette[pixel!.colorIndex]]);
      } else {
        const bgColorId0 = ppuInfo.BGP_ff47 & 0x03;
        const bgColorId1 = (ppuInfo.BGP_ff47 >> 2) & 0x03;
        const bgColorId2 = (ppuInfo.BGP_ff47 >> 4) & 0x03;
        const bgColorId3 = (ppuInfo.BGP_ff47 >> 6) & 0x03;
        const backgroundColorPalette = [bgColorId0, bgColorId1, bgColorId2, bgColorId3];

        this.sendToLCD(this.colors[backgroundColorPalette[pixel!.colorIndex]]);
      }

      if (ppuInfo.debugEnabled) {
        this.maybeDrawDebugScrollFrame();
      }

      this.pixelsSentToLCDForCurrentLine = (this.pixelsSentToLCDForCurrentLine + 1) % 160;
    }
  }

  private maybeDrawDebugScrollFrame() {
    const scrollX = this.getPPUInfo().SCX_ff43;
    const scrollY = this.getPPUInfo().SCY_ff42;

    // Top
    if (this.currentLine === 0) {
      this.lcdDebugRenderer.drawScrollBorderPixel((scrollX + this.pixelsSentToLCDForCurrentLine) % 256, scrollY);
    }

    // Bottom
    if (this.currentLine === 143) {
      this.lcdDebugRenderer.drawScrollBorderPixel(
        (scrollX + this.pixelsSentToLCDForCurrentLine) % 256,
        (scrollY + 144) % 256,
      );
    }

    // Left and right border
    this.lcdDebugRenderer.drawScrollBorderPixel(scrollX, (this.currentLine + scrollY) % 256);
    this.lcdDebugRenderer.drawScrollBorderPixel((scrollX + 160) % 256, (this.currentLine + scrollY) % 256);
  }
}

/**
 * Simple PPU Impl with a few debugging infos.
 * Known issues:
 * -> tileAddressingMode = (this.LCDC >> 4) & 0x1; for background/window is not updated between lines which breaks layout for some games.
 */
export class PPUImpl implements PPU {
  // VRAM 8000-9FFF, 8192 bytes
  private vram: number[] = [];

  // $FE00-FE9F, OAM, holds 160 bytes of object attributes, 40 entries, 4 bytes each
  private oam: number[] = [];

  // PPU modes, 2 = OAM scan, 3 drawing pixels, 0 hblank, 1 vblank
  private mode = 2;

  private renderPipeline: RenderPipeline;

  private objectsForScanline: OAMEntry[] = [];

  // LCDC, can be modified mid scan line
  private LCDC_ff40 = 0x91;
  // STAT
  private STAT_ff41 = 0;
  // SCY
  private SCY_ff42 = 0;
  // SCX
  private SCX_ff43 = 0;
  // LY read only
  private LY_ff44 = 0;

  // LYC
  private LYC_ff45 = 0;

  // BGP BG pallette data
  private BGP_ff47 = 0;

  // OBP0, lower two bits ignored, color index 0 is transparent
  private OBP0_ff48 = 0;
  // OBP1, lower two bits ignored, color index 0 is transparent
  private OBP1_ff49 = 0;

  // We just use this to keep track of the current coordinates on the screen
  // 160x144
  private x = 0;
  private y = 0;

  private allPixelsGeneratedForLine = false;

  // our current dot position
  private dots = 0;
  // we're keeping track of the penalty in mode 3
  private penalty = 0;

  // WY
  private WY_ff4a = 0;
  // WX
  private WX_ff4b = 0;

  // ppu is enabled on startup
  private ppuEnabled = true;
  private isFirstFrameAfterPPUEnabled = false;

  private debugRenderer: LcdDebugRenderer;

  // Let's just keep this running in the background.
  // For slow machines we might want to turn this off.
  private debugRenderingEnabled = true;

  constructor(
    private lcdCanvas: HTMLCanvasElement,
    private tileCanvas: HTMLCanvasElement,
    private backgroundCanvas: HTMLCanvasElement,
    private interrupts: Interrupts,
  ) {
    const getPPUInfoForRenderPipeline = (): PPUInfoForPixelFetcher => ({
      LCDC_ff40: this.LCDC_ff40,
      SCY_ff42: this.SCY_ff42,
      SCX_ff43: this.SCX_ff43,
      BGP_ff47: this.BGP_ff47,
      OBP0_ff48: this.OBP0_ff48,
      OBP1_ff49: this.OBP1_ff49,
      WY_ff4a: this.WY_ff4a,
      WX_ff4b: this.WX_ff4b,
      objectsForScanline: this.objectsForScanline,
      debugEnabled: this.debugRenderingEnabled,
    });

    this.debugRenderer = new LcdDebugRenderer(tileCanvas, backgroundCanvas, this.vram, getPPUInfoForRenderPipeline);

    const lcdCanvasContext = lcdCanvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
    const lcdCanvasData = lcdCanvasContext.getImageData(0, 0, this.lcdCanvas.width, this.lcdCanvas.height);

    const sendPixelToLCD = (rgba: RGBA) => {
      // draw
      LcdUtils.drawPixel(lcdCanvasData, 160, this.x, this.y, rgba);
      // update coords
      this.x = (this.x + 1) % 160;
      // new line
      if (this.x === 0) {
        this.allPixelsGeneratedForLine = true;
        this.y = (this.y + 1) % 144;
        if (this.y === 0) {
          // we're done, we can update the buffer on the canvas if this is not the first frame after a recent switch on
          if (this.isFirstFrameAfterPPUEnabled) {
            // do nothing, we should actually render a white frame
            this.isFirstFrameAfterPPUEnabled = false;
          } else {
            lcdCanvasContext.putImageData(lcdCanvasData, 0, 0);
          }
        }
      }
    };

    const backgroundWindowPixelFetcher = new BackgroundWindowPixelFetcher(this.vram, getPPUInfoForRenderPipeline);

    const spritePixelFetcher = new SpritePixelFetcher(this.vram, getPPUInfoForRenderPipeline);

    this.renderPipeline = new RenderPipeline(
      backgroundWindowPixelFetcher,
      spritePixelFetcher,
      getPPUInfoForRenderPipeline,
      sendPixelToLCD,
      this.debugRenderer,
    );
  }

  private scxAtBeginningOfScanLine = 0x0;

  tick(): void {
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
      if (((this.STAT_ff41 >> 5) & 0b1) === 1) {
        const currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
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
      if (((this.STAT_ff41 >> 3) & 0b1) === 1) {
        const currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
      }
    }

    // STAT reg update:
    // update PPU mode
    this.STAT_ff41 = (this.STAT_ff41 & 0b1111_1100) | (this.mode & 0b11);
    // Check LYC === LY
    if (this.LY_ff44 === this.LYC_ff45) {
      // update stat register and fire interrupt if this hasn't happened already
      if ((this.STAT_ff41 & 0b100) === 0) {
        this.STAT_ff41 = this.STAT_ff41 | 0b100;
        // check if we need to fire interrupt
        if (((this.STAT_ff41 >> 6) & 0b1) === 1) {
          const currentInterruptFlags = this.interrupts.getInterruptFlag();
          this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
        }
      }
    } else {
      // unset LYC === LC flag in stat
      this.STAT_ff41 = this.STAT_ff41 & 0b1111_1011;
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
    const dotPerLine = 456;
    const numberOfScanLines = 154;
    this.dots = (this.dots + 1) % dotPerLine;
    if (this.dots === 0) {
      this.LY_ff44 = (this.LY_ff44 + 1) % numberOfScanLines;
      if (this.LY_ff44 === 144) {
        // vblank, mode 1
        this.mode = 1;
        const currentInterruptFlags = this.interrupts.getInterruptFlag();
        this.interrupts.setInterruptFlag(currentInterruptFlags | 0x1);
        // also fire mode 1 STAT interrupt if requested
        if (((this.STAT_ff41 >> 4) & 0b1) === 1) {
          const currentInterruptFlags = this.interrupts.getInterruptFlag();
          this.interrupts.setInterruptFlag(currentInterruptFlags | 0b10);
        }
      } else if (this.LY_ff44 === 0) {
        // we're back at the start
        this.mode = 2;
        this.x = 0;
        this.y = 0;
        this.debugRenderer.resetForNextFrame();
      }
    }
  }

  scanObject(objectIndex: number) {
    if (this.objectsForScanline.length < 10) {
      const tileHeight = ((this.LCDC_ff40 >> 2) & 0x1) === 0 ? 8 : 16;
      const oamLocation = objectIndex * 4; // 4 bytes per object
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
  }

  getLCDC(): number {
    return this.LCDC_ff40;
  }

  writeFF40(value: number) {
    const ppuEnabledBeforeUpdate = this.ppuEnabled;
    this.LCDC_ff40 = value & 0xff;
    this.ppuEnabled = ((this.LCDC_ff40 >> 7) & 0x1) === 1;
    // when turning on the screen, it'll stay blank for the first frame
    if (ppuEnabledBeforeUpdate && !this.ppuEnabled) {
      // display switched off
      this.mode = 0;
      this.LY_ff44 = 0;
      this.x = 0;
      this.y = 0;
      this.STAT_ff41 = this.STAT_ff41 & 0b1111_1100;
    } else if (!ppuEnabledBeforeUpdate && this.ppuEnabled) {
      this.isFirstFrameAfterPPUEnabled = true;
      // display switched on
      // todo double check if we have to throw LYC interrupt
    }
  }
  readFF40(): number {
    return this.LCDC_ff40;
  }
  writeFF41(value: number) {
    // lower three bit are read only
    const lowerThreeBits = this.STAT_ff41 & 0b111;
    this.STAT_ff41 = (value & 0b1111_1000) | lowerThreeBits;
  }
  readFF41(): number {
    return (this.STAT_ff41 & 0b1111_1000) | this.mode;
  }
  writeFF42(value: number) {
    this.SCY_ff42 = value & 0xff;
  }
  readFF42(): number {
    return this.SCY_ff42;
  }
  writeFF43(value: number) {
    this.SCX_ff43 = value & 0xff;
  }
  readFF43(): number {
    return this.SCX_ff43;
  }
  readFF44(): number {
    return this.LY_ff44;
  }
  writeFF45(value: number): void {
    this.LYC_ff45 = value & 0xff;
  }
  readFF45(): number {
    return this.LYC_ff45;
  }
  writeFF47(value: number): void {
    this.BGP_ff47 = value & 0xff;
  }
  readFF47(): number {
    return this.BGP_ff47;
  }
  writeFF48(value: number): void {
    this.OBP0_ff48 = value & 0xff;
  }
  readFF48(): number {
    return this.OBP0_ff48;
  }
  writeFF49(value: number): void {
    this.OBP1_ff49 = value & 0xff;
  }
  readFF49(): number {
    return this.OBP1_ff49;
  }
  writeFF4A(value: number) {
    this.WY_ff4a = value & 0xff;
  }
  readFF4A(): number {
    return this.WY_ff4a;
  }
  writeFF4B(value: number) {
    this.WX_ff4b = value & 0xff;
  }
  readFF4B(): number {
    return this.WX_ff4b;
  }

  writeVram(address: number, value: number): void {
    this.vram[address] = value & 0xff;
  }
  readVram(address: number): number {
    return this.vram[address];
  }
  writeOAM(address: number, value: number): void {
    this.oam[address] = value & 0xff;
  }
  readOAM(address: number): number {
    return this.oam[address];
  }
  logDebugInfo(): void {
    this.debugRenderingEnabled = true;
  }
}
