import { CPU } from "./cpu";

export type GetArg = () => number;
export type SetArg = (value: number) => void;
type TCycles = number;
type CbOp = (getArg: GetArg, setArg: SetArg, cpu: CPU) => TCycles;

export class CBOps {
  static rlc = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();

    const cFlag = (value & 0x80) > 0 ? 1 : 0;

    const result = ((value << 1) & 0xff) | cFlag;
    setArg(result);

    const zFlag = result === 0 ? 1 : 0;

    cpu.setFlagZ(zFlag);
    cpu.setFlagC(cFlag);

    cpu.setFlagN(0);
    cpu.setFlagH(0);
    return 8;
  };

  static rrc = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const result = ((value >> 1) & 0xff) | ((value << 7) & 0xff);
    setArg(result);

    const zFlag = result === 0 ? 1 : 0;
    const cFlag = value & 0x1;

    cpu.setFlagZ(zFlag);
    cpu.setFlagC(cFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(0);

    return 8;
  };

  static rl = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    // carry is part of the rotate operation
    const value = getArg();
    const result = ((value << 1) | cpu.getFlagC()) & 0xff;
    setArg(result);

    const zFlag = result === 0 ? 1 : 0;
    const cFlag = (value >> 7) & 0x1;

    cpu.setFlagZ(zFlag);
    cpu.setFlagC(cFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(0);

    return 8;
  };

  static rr = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    // carry is part of the rotate operation
    const value = getArg();
    const result = (value >> 1) | ((cpu.getFlagC() << 7) & 0xff);
    setArg(result);

    const zFlag = result === 0 ? 1 : 0;
    const cFlag = value & 0x1;

    cpu.setFlagZ(zFlag);
    cpu.setFlagC(cFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(0);

    return 8;
  };

  static swap = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const result = (((value & 0xf0) >> 4) | ((value & 0x0f) << 4)) & 0xff;
    setArg(result);
    cpu.setFlagN(0);
    cpu.setFlagC(0);
    cpu.setFlagH(0);
    const zFlag = result === 0 ? 1 : 0;
    cpu.setFlagZ(zFlag);
    return 8;
  };

  static sla = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const result = (value << 1) & 0xff;
    setArg(result);
    cpu.setFlagN(0);
    cpu.setFlagH(0);
    const zFlag = result === 0 ? 1 : 0;
    cpu.setFlagZ(zFlag);
    const cFlag = (value & 0x80) === 0x80 ? 1 : 0;
    cpu.setFlagC(cFlag);
    return 8; // todo, cycle count is wrong for HL, probably in the other ones too
  };

  static sra = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const result = ((value >> 1) | (value & 0x80)) & 0xff;
    setArg(result);
    cpu.setFlagN(0);
    cpu.setFlagH(0);
    const zFlag = result === 0 ? 1 : 0;
    cpu.setFlagZ(zFlag);
    const cFlag = value & 0x1;
    cpu.setFlagC(cFlag);
    return 8; // todo, cycle count is wrong for HL, probably in the other ones too
  };

  static srl = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const cFlag = value & 0x1;
    const result = value >> 1;
    const zFlag = result === 0 ? 1 : 0;
    setArg(result);
    cpu.setFlagZ(zFlag);
    cpu.setFlagC(cFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(0);

    return 8;
  };

  static bit0 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 0;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit1 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 1;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit2 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 2;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit3 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 3;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit4 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 4;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit5 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 5;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit6 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 6;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static bit7 = (getArg: GetArg, setArg: SetArg, cpu: CPU): TCycles => {
    const value = getArg();
    const bitPos = 7;
    const zFlag = ((value >> bitPos) & 0x1) === 1 ? 0 : 1;
    cpu.setFlagZ(zFlag);
    cpu.setFlagN(0);
    cpu.setFlagH(1);
    return 8;
  };

  static res0 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 0) & 0xff));
    return 8;
  };

  static res1 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 1) & 0xff));
    return 8;
  };

  static res2 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 2) & 0xff));
    return 8;
  };
  static res3 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 3) & 0xff));
    return 8;
  };
  static res4 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 4) & 0xff));
    return 8;
  };
  static res5 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 5) & 0xff));
    return 8;
  };
  static res6 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 6) & 0xff));
    return 8;
  };

  static res7 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value & (~(0x1 << 7) & 0xff));
    return 8;
  };

  static set0 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 0) & 0xff));
    return 8;
  };

  static set1 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 1) & 0xff));
    return 8;
  };

  static set2 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 2) & 0xff));
    return 8;
  };
  static set3 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 3) & 0xff));
    return 8;
  };
  static set4 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 4) & 0xff));
    return 8;
  };
  static set5 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 5) & 0xff));
    return 8;
  };
  static set6 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 6) & 0xff));
    return 8;
  };

  static set7 = (getArg: GetArg, setArg: SetArg): TCycles => {
    const value = getArg();
    setArg(value | ((0x1 << 7) & 0xff));
    return 8;
  };

  static opsTable: (CbOp | null)[][] = [
    // No need for 16 columns since a single row has at most 2 different operation types
    [this.rlc, this.rrc], // 0x0
    [this.rl, this.rr], // 0x1
    [this.sla, this.sra], // 0x2
    [this.swap, this.srl], // 0x3
    [this.bit0, this.bit1], // 0x4
    [this.bit2, this.bit3], // 0x5
    [this.bit4, this.bit5], // 0x6
    [this.bit6, this.bit7], // 0x7
    [this.res0, this.res1], // 0x8
    [this.res2, this.res3], // 0x9
    [this.res4, this.res5], // 0xA
    [this.res6, this.res7], // 0xB
    [this.set0, this.set1], // 0xC
    [this.set2, this.set3], // 0xD
    [this.set4, this.set5], // 0xE
    [this.set6, this.set7], // 0xF
  ];
}
