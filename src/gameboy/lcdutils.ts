export type RGBA = [number, number, number, number];

export class LcdUtils {
  static drawPixel(canvasData: ImageData, canvasWidth: number, x: number, y: number, color: RGBA) {
    var index = (x + y * canvasWidth) * 4;

    canvasData.data[index + 0] = color[0];
    canvasData.data[index + 1] = color[1];
    canvasData.data[index + 2] = color[2];
    canvasData.data[index + 3] = color[3];
  }

  static drawPixelWithDecay(canvasData: ImageData, canvasWidth: number, x: number, y: number, color: RGBA) {
    var index = (x + y * canvasWidth) * 4;

    const decayFactor = 0.65;
    canvasData.data[index + 0] = (1 - decayFactor) * color[0] + decayFactor * canvasData.data[index + 0];
    canvasData.data[index + 1] = (1 - decayFactor) * color[1] + decayFactor * canvasData.data[index + 1];
    canvasData.data[index + 2] = (1 - decayFactor) * color[2] + decayFactor * canvasData.data[index + 2];

    // Just to avoid some rounding issues
    const distance = 3;
    if (Math.abs(canvasData.data[index + 0] - color[0]) < distance) {
      canvasData.data[index + 0] = color[0];
    }

    if (Math.abs(canvasData.data[index + 1] - color[1]) < distance) {
      canvasData.data[index + 1] = color[1];
    }

    if (Math.abs(canvasData.data[index + 2] - color[2]) < distance) {
      canvasData.data[index + 2] = color[2];
    }

    // We're not dealing with any alpha values
    canvasData.data[index + 3] = 255;
  }
}
