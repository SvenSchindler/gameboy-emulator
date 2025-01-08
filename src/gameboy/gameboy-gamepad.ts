import { JoyPad } from "./joypad";

// Called it GameboyGamepad to avoid confusion with the gamepad api.
export class GameboyGamepad {
  private startPressed = false;
  private selectPressed = false;
  private APressed = false;
  private BPressed = false;

  private leftPressed = false;
  private rightPressed = false;
  private upPressed = false;
  private downPressed = false;

  constructor(private joypad: JoyPad) {}

  tick() {
    const gp = navigator.getGamepads()[0];
    // No gamepad found
    if (!gp) {
      return;
    }

    // Start button 1
    if (gp.buttons[1].pressed && !this.startPressed) {
      // Pressed start
      this.startPressed = true;
      this.joypad.pressStartButton();
    } else if (!gp.buttons[1].pressed && this.startPressed) {
      // Released start
      this.startPressed = false;
      this.joypad.releaseStartButton();
    }

    // Select button 3
    if (gp.buttons[3].pressed && !this.selectPressed) {
      this.selectPressed = true;
      this.joypad.pressSelectButton();
    } else if (!gp.buttons[3].pressed && this.selectPressed) {
      this.selectPressed = false;
      this.joypad.releaseSelectButton();
    }

    // A button 0
    if (gp.buttons[0].pressed && !this.APressed) {
      this.APressed = true;
      this.joypad.pressAButton();
    } else if (!gp.buttons[0].pressed && this.APressed) {
      this.APressed = false;
      this.joypad.releaseAButton();
    }

    // B button 2
    if (gp.buttons[2].pressed && !this.BPressed) {
      this.BPressed = true;
      this.joypad.pressBButton();
    } else if (!gp.buttons[2].pressed && this.BPressed) {
      this.BPressed = false;
      this.joypad.releaseBButton();
    }

    // Left 14
    if (gp.buttons[14].pressed && !this.leftPressed) {
      this.leftPressed = true;
      this.joypad.pressLeft();
    } else if (!gp.buttons[14].pressed && this.leftPressed) {
      this.leftPressed = false;
      this.joypad.releaseLeft();
    }

    // Right 15
    if (gp.buttons[15].pressed && !this.rightPressed) {
      this.rightPressed = true;
      this.joypad.pressRight();
    } else if (!gp.buttons[15].pressed && this.rightPressed) {
      this.rightPressed = false;
      this.joypad.releaseRight();
    }

    // Up 12
    if (gp.buttons[12].pressed && !this.upPressed) {
      this.upPressed = true;
      this.joypad.pressUp();
    } else if (!gp.buttons[12].pressed && this.upPressed) {
      this.upPressed = false;
      this.joypad.releaseUp();
    }

    // Down 13
    if (gp.buttons[13].pressed && !this.downPressed) {
      this.downPressed = true;
      this.joypad.pressDown();
    } else if (!gp.buttons[13].pressed && this.downPressed) {
      this.downPressed = false;
      this.joypad.releaseDown();
    }
  }
}
