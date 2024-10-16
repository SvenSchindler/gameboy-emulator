export interface Serial {
  writeSB(value: number): void;
  writeSC(value: number): void;
}

export class SerialImpl implements Serial {
  private SB = 0x00;
  private SC = 0x00;

  private dataAsText: string = "";

  writeSB(value: number): void {
    this.SB = value & 0xff;
    this.dataAsText = this.dataAsText + String.fromCharCode(value & 0xff);
    // Use this for debugging serial output
    // console.log('serial output: ' + this.dataAsText);
  }

  writeSC(value: number): void {
    this.SC = value & 0xff;
  }
}
