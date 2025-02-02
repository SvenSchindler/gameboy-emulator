import { Gameboy } from "./gameboy/gameboy";
import { assertExists, toHexString } from "./gameboy/utils";

let gameboy: Gameboy | undefined;

let isDebugging = false;
let isMuted = false;
let showRetroScreen = false;

// Read some flags provided via url parameters
const params = new URLSearchParams(window.location.search);
const enableWebGl = params.get("enableWebGl") === "true";

const loadRom = (i: HTMLInputElement) => () => {
  let file = assertExists(i.files?.item(0), "No file selected?");

  if (gameboy) {
    gameboy.kill();
  }

  gameboy = new Gameboy(enableWebGl);
  isDebugging = false;
  updateDebugButton();

  file.arrayBuffer().then((romData) => {
    const romDataUint8 = new Uint8Array(romData);
    gameboy?.load(romDataUint8);
    const cartridgeType = gameboy?.getCartridgeType();
    if (cartridgeType && cartrigeTypeOutput) {
      cartrigeTypeOutput.innerHTML = cartridgeType;
    }
    if (isMuted) {
      gameboy?.mute();
    }
  });
};

// Overall layer wrapping all cpu specific outputs.
// Hidden while running.
const cpuDetails = assertExists(document.getElementById("cpuDetails"), "CPU details layer doesn't exist");

const commandOutput = assertExists(document.getElementById("nextCommands"), "Command output doesn't exist");
const registersOutput = assertExists(document.getElementById("registers"), "Registers output doesn't exist");
const flagsOutput = assertExists(document.getElementById("flags"), "Flags output doesn't exist");
const cartrigeTypeOutput = assertExists(
  document.getElementById("cartridgeType"),
  "Cartridge type output doesn't exist",
);
const stackInfoOutput = assertExists(document.getElementById("stackInfo"), "Stack info output doesn't exist");
const debugInfos = assertExists(document.getElementById("debugInfos"), "Debug infos view doesn't exist");

const romFileInput = assertExists(document.getElementById("romFileInput"), "Rom file input doesnt exist");
const muteButton = assertExists(document.getElementById("muteButton"), "Mute button doesnt exists");
const retroButton = assertExists(document.getElementById("retroButton"), "Retro button doesnt exists");
const debugButton = assertExists(document.getElementById("debugButton"), "Debug button doesnt exists");

// UI Buttons
const startButton = assertExists(document.getElementById("startButton"), "Start button doesnt exists");
const selectButton = assertExists(document.getElementById("selectButton"), "Select button doesnt exists");
const AButton = assertExists(document.getElementById("AButton"), "A button doesnt exists");
const BButton = assertExists(document.getElementById("BButton"), "B button doesnt exists");

const upButton = assertExists(document.getElementById("UpButton"), "Up button doesnt exists");
const downButton = assertExists(document.getElementById("DownButton"), "Down button doesnt exists");
const leftButton = assertExists(document.getElementById("LeftButton"), "Left button doesnt exists");
const rightButton = assertExists(document.getElementById("RightButton"), "Right button doesnt exists");

const gameboyImage = assertExists(
  document.getElementById("gameboy"),
  "Gameboy image doesnt exists",
) as HTMLImageElement;

if (romFileInput) {
  romFileInput.onchange = loadRom(romFileInput as HTMLInputElement);
}

let breakpoint = -1;
// Default condition is always true.
// Condition is checked while debugging,
// replace it with something more complex if required.
let condition = () => true;

(window as any).setDebug = (pc: number) => {
  console.log(`setting breakpoint at ${pc}`);
  breakpoint = pc;
  updateDebugWindows();
};

(window as any).setBreakpoint = () => {
  const breakpointInput = document.getElementById("breakpointInput") as HTMLInputElement;
  breakpoint = parseInt(breakpointInput?.value ?? "-1");
  updateDebugWindows();
};

(window as any).clearCondition = () => {
  condition = () => true;
};

let updateDebugWindows = () => {
  debugInfos.style.display = "inline";
  const body = document.getElementsByTagName("body")[0];
  body.style.overflow = "auto";
  let commands = gameboy?.getNextCommands();
  if (commandOutput && commands) {
    commandOutput.innerHTML = commands
      .map((c, i) => {
        let color = "#FFFFFF";
        if (c[0] === breakpoint) {
          color = "#FF0000";
        } else if (i === 0) {
          color = "#AAAAFF";
        }
        return `<div onclick='setDebug(${c[0]})' style='background-color:${color}'>${toHexString(c[0])}: ${c[1]}</div>`;
      })
      .join("");
  }

  let registers = gameboy?.getRegisterInfo();
  if (registers) {
    registersOutput.innerHTML = registers.map((c) => `<div>${c[0]}: ${c[1]}</div>`).join("");
  }

  let flags = gameboy?.getFlagInfo();
  if (flags) {
    flagsOutput.innerHTML = flags.map((c) => `<div>${c[0]}: ${c[1]}</div>`).join("");
  }

  const stack = gameboy?.getStackInfo();
  if (stack) {
    stackInfoOutput.innerHTML = stack
      .filter((e) => e !== undefined)
      .map((e) => `<div>${toHexString(e)}</div>`)
      .join("");
  }
};

const updateDebugButton = () => {
  if (isDebugging) {
    debugButton.innerText = "Resume";
    debugButton.onclick = resume;
  } else {
    debugButton.innerText = "Debug";
    debugButton.onclick = debug;
  }
};

const resume = () => {
  isDebugging = false;
  gameboy?.continue();
  cpuDetails.style.visibility = "hidden";
  updateDebugButton();
};

const debug = () => {
  isDebugging = true;
  cpuDetails.style.visibility = "visible";
  console.log("debugging enabled");
  gameboy?.startDebug();
  updateDebugWindows();
  updateDebugButton();
};

debugButton.onclick = debug;

// Muting / unmuting

const muteButtonClick = () => {
  if (isMuted) {
    muteButton.innerText = "Mute";
    gameboy?.unmute();
    isMuted = false;
  } else {
    muteButton.innerText = "Unmute";
    gameboy?.mute();
    isMuted = true;
  }
};

muteButton.onclick = muteButtonClick;

// Retro look
const retroButtonClick = () => {
  if (showRetroScreen) {
    showRetroScreen = false;
    gameboyImage.src = "img/gb.png";
  } else {
    showRetroScreen = true;
    gameboyImage.src = "img/gb-retro.png";
  }
  gameboy?.setShowRetroScreen(showRetroScreen);
};

retroButton.onclick = retroButtonClick;

// UI Button bindings

const configureUiButton = (button: HTMLElement, onPress: () => void, onRelease: () => void) => {
  button.ontouchstart = (e) => {
    onPress();
    e.preventDefault();
  };
  button.onmousedown = (e) => {
    onPress();
    e.preventDefault();
  };
  button.ontouchend = (e) => {
    onRelease();
    e.preventDefault();
  };
  button.onmouseup = (e) => {
    onRelease();
    e.preventDefault();
  };
};

configureUiButton(
  startButton,
  () => gameboy?.pressStart(),
  () => gameboy?.releaseStart(),
);
configureUiButton(
  selectButton,
  () => gameboy?.pressSelect(),
  () => gameboy?.releaseSelect(),
);
configureUiButton(
  AButton,
  () => gameboy?.pressA(),
  () => gameboy?.releaseA(),
);
configureUiButton(
  BButton,
  () => gameboy?.pressB(),
  () => gameboy?.releaseB(),
);

configureUiButton(
  upButton,
  () => gameboy?.pressUp(),
  () => gameboy?.releaseUp(),
);
configureUiButton(
  downButton,
  () => gameboy?.pressDown(),
  () => gameboy?.releaseDown(),
);
configureUiButton(
  leftButton,
  () => gameboy?.pressLeft(),
  () => gameboy?.releaseLeft(),
);
configureUiButton(
  rightButton,
  () => gameboy?.pressRight(),
  () => gameboy?.releaseRight(),
);

// Keypress handlers

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "d") {
    // Also opens debug controls
    debug();
  } else if (e.key === "s" && isDebugging) {
    gameboy?.step();
    updateDebugWindows();
  } else if (e.key === "f" && isDebugging) {
    // step x times
    const steps = 1000;
    let i = 0;
    const step = () => {
      gameboy?.step();
      updateDebugWindows();
      i++;
      if (i < steps) {
        setTimeout(step, 0);
      }
    };
    step();
  } else if (e.key === "b" && isDebugging) {
    if (breakpoint < 0) {
      alert("Set a breakpoint first");
      return;
    }

    // return if we're already at the breakpoint
    if (gameboy?.getPC() === breakpoint && condition()) {
      return;
    }

    const step = () => {
      // Bit of a hack to speed things up since setTimeout adds too much additional delay.
      for (let i = 0; i < 100000; i++) {
        gameboy?.step();
        if (gameboy?.getPC() === breakpoint && condition() === true) {
          updateDebugWindows();
          return;
        }
      }

      gameboy?.step();
      updateDebugWindows();
      if (gameboy?.getPC() !== breakpoint || condition() === false) {
        setTimeout(step, 0);
      }
    };
    step();
  } else if (e.key === "c" && isDebugging) {
    resume();
  } else if (e.key === "n" || e.key === "Enter") {
    console.log("start pressed");
    gameboy?.pressStart();
  } else if (e.key === "m") {
    console.log("select pressed");
    gameboy?.pressSelect();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    gameboy?.pressLeft();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    gameboy?.pressRight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    gameboy?.pressUp();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    gameboy?.pressDown();
  } else if (e.key === "z") {
    gameboy?.pressA();
  } else if (e.key === "x") {
    gameboy?.pressB();
  } else if (e.key === "q") {
    gameboy?.startRecordingPcs();
  } else if (e.key === "w") {
    gameboy?.stopRecordingPcs();
  } else {
    console.log("unhandled key pressed: " + e.key);
  }
});

document.addEventListener("keyup", (e: KeyboardEvent) => {
  if (e.key === "n" || e.key === "Enter") {
    console.log("start released");
    gameboy?.releaseStart();
  } else if (e.key === "m") {
    console.log("select released");
    gameboy?.releaseSelect();
  } else if (e.key === "ArrowLeft") {
    gameboy?.releaseLeft();
  } else if (e.key === "ArrowRight") {
    gameboy?.releaseRight();
  } else if (e.key === "ArrowUp") {
    gameboy?.releaseUp();
  } else if (e.key === "ArrowDown") {
    gameboy?.releaseDown();
  } else if (e.key === "z") {
    gameboy?.releaseA();
  } else if (e.key === "x") {
    gameboy?.releaseB();
  }
});
