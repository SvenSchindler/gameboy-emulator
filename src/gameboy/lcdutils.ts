export type RGBA = [number, number, number, number];

export class LcdUtils {
  static drawPixel(canvasData: ImageData, canvasWidth: number, x: number, y: number, color: RGBA) {
    var index = (x + y * canvasWidth) * 4;
    canvasData.data[index + 0] = color[0];
    canvasData.data[index + 1] = color[1];
    canvasData.data[index + 2] = color[2];
    canvasData.data[index + 3] = color[3];
  }
}
