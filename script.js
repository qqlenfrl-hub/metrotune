const bpmInput = document.querySelector("#bpmInput");
const bpmDisplay = document.querySelector("#bpmDisplay");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const decreaseBpm = document.querySelector("#decreaseBpm");
const increaseBpm = document.querySelector("#increaseBpm");
const pendulum = document.querySelector("#pendulum");
const statusPill = document.querySelector("#statusPill");
const tunerButton = document.querySelector("#tunerButton");
const noteName = document.querySelector("#noteName");
const frequency = document.querySelector("#frequency");
const targetNote = document.querySelector("#targetNote");
const centDiff = document.querySelector("#centDiff");
const tunerNeedle = document.querySelector("#tunerNeedle");
const tuningState = document.querySelector("#tuningState");

const minBpm = 40;
const maxBpm = 220;
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const guitarNotes = [
  { note: "E2", frequency: 82.41 },
  { note: "A2", frequency: 110 },
  { note: "D3", frequency: 146.83 },
  { note: "G3", frequency: 196 },
  { note: "B3", frequency: 246.94 },
  { note: "E4", frequency: 329.63 },
];

let audioContext;
let timerId;
let isRunning = false;
let currentBpm = 100;
let swingSide = false;

let tunerStream;
let tunerSource;
let analyser;
let tunerAnimation;
let isTunerRunning = false;
let selectedTarget = null;
let referenceOscillator;
let referenceGain;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      statusPill.textContent = "Local";
    });
  });
}

function clampBpm(value) {
  return Math.min(maxBpm, Math.max(minBpm, Math.round(Number(value) || currentBpm)));
}

function setBpm(value) {
  currentBpm = clampBpm(value);
  bpmInput.value = currentBpm;
  bpmDisplay.textContent = currentBpm;
  updatePresetState();

  if (isRunning) {
    scheduleMetronome();
  }
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

async function resumeAudio() {
  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

function playClick() {
  const ctx = ensureAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(1040, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.07);
}

function tick() {
  playClick();
  swingSide = !swingSide;
  pendulum.classList.toggle("left", !swingSide);
  pendulum.classList.toggle("right", swingSide);
}

function scheduleMetronome() {
  window.clearInterval(timerId);
  if (!isRunning) return;
  timerId = window.setInterval(tick, 60000 / currentBpm);
}

async function startMetronome() {
  await resumeAudio();
  if (isRunning) return;

  isRunning = true;
  swingSide = false;
  statusPill.textContent = "Playing";
  tick();
  scheduleMetronome();
}

function stopMetronome() {
  isRunning = false;
  window.clearInterval(timerId);
  statusPill.textContent = "Ready";
  pendulum.classList.remove("left", "right");
}

function updatePresetState() {
  document.querySelectorAll("[data-bpm]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.bpm) === currentBpm);
  });
}

function frequencyToNote(freq) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const note = noteNames[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const targetFrequency = 440 * 2 ** ((midi - 69) / 12);
  const cents = 1200 * Math.log2(freq / targetFrequency);
  return { note: `${note}${octave}`, cents, frequency: targetFrequency };
}

function closestGuitarTarget(freq) {
  if (selectedTarget) return selectedTarget;

  return guitarNotes.reduce((closest, candidate) => {
    const closestDistance = Math.abs(1200 * Math.log2(freq / closest.frequency));
    const candidateDistance = Math.abs(1200 * Math.log2(freq / candidate.frequency));
    return candidateDistance < closestDistance ? candidate : closest;
  }, guitarNotes[0]);
}

function centsAgainstTarget(freq, targetFrequency) {
  return 1200 * Math.log2(freq / targetFrequency);
}

function updateTuningMeter(cents) {
  const clamped = Math.max(-50, Math.min(50, cents));
  tunerNeedle.style.left = `${50 + clamped}%`;

  if (Math.abs(cents) <= 5) {
    tuningState.textContent = "In Tune";
  } else if (cents < 0) {
    tuningState.textContent = "Flat";
  } else {
    tuningState.textContent = "Sharp";
  }
}

function autoCorrelate(buffer, sampleRate) {
  const size = buffer.length;
  let rms = 0;

  for (let i = 0; i < size; i += 1) {
    rms += buffer[i] * buffer[i];
  }

  rms = Math.sqrt(rms / size);
  if (rms < 0.012) return -1;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const maxSamples = Math.floor(size / 2);

  for (let offset = 24; offset < maxSamples; offset += 1) {
    let correlation = 0;

    for (let i = 0; i < maxSamples; i += 1) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }

    correlation = 1 - correlation / maxSamples;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  return bestCorrelation > 0.88 && bestOffset > 0 ? sampleRate / bestOffset : -1;
}

function updateTuner() {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  const detected = autoCorrelate(buffer, audioContext.sampleRate);

  if (detected > 0) {
    const detectedNote = frequencyToNote(detected);
    const target = closestGuitarTarget(detected);
    const cents = centsAgainstTarget(detected, target.frequency);

    noteName.textContent = detectedNote.note;
    frequency.textContent = `${detected.toFixed(1)} Hz`;
    targetNote.textContent = `Target ${target.note} (${target.frequency.toFixed(2)} Hz)`;
    centDiff.textContent = `${cents > 0 ? "+" : ""}${cents.toFixed(1)} cents`;
    updateTuningMeter(cents);
  } else {
    frequency.textContent = "Play a note";
  }

  tunerAnimation = requestAnimationFrame(updateTuner);
}

async function startTuner() {
  try {
    await resumeAudio();
    tunerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tunerSource = audioContext.createMediaStreamSource(tunerStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    tunerSource.connect(analyser);

    isTunerRunning = true;
    tunerButton.textContent = "Mic Off";
    tunerButton.classList.add("active");
    tuningState.textContent = "Listening";
    updateTuner();
  } catch (error) {
    noteName.textContent = "--";
    frequency.textContent = "Mic permission needed";
    tuningState.textContent = "Idle";
  }
}

function stopTuner() {
  isTunerRunning = false;
  cancelAnimationFrame(tunerAnimation);
  tunerStream?.getTracks().forEach((track) => track.stop());
  tunerStream = null;
  tunerSource = null;
  analyser = null;
  tunerButton.textContent = "Mic On";
  tunerButton.classList.remove("active");
  noteName.textContent = "--";
  frequency.textContent = "Mic waiting";
  tuningState.textContent = "Idle";
  tunerNeedle.style.left = "50%";
}

function stopReferenceTone() {
  if (!referenceOscillator) return;
  const now = audioContext.currentTime;
  referenceGain.gain.cancelScheduledValues(now);
  referenceGain.gain.setTargetAtTime(0.0001, now, 0.03);
  referenceOscillator.stop(now + 0.12);
  referenceOscillator = null;
  referenceGain = null;
}

async function playReferenceTone(note, freq) {
  await resumeAudio();
  stopReferenceTone();

  selectedTarget = { note, frequency: freq };
  targetNote.textContent = `Target ${note} (${freq.toFixed(2)} Hz)`;
  centDiff.textContent = "Reference tone playing";

  document.querySelectorAll("[data-note]").forEach((button) => {
    button.classList.toggle("active", button.dataset.note === note);
  });

  referenceOscillator = audioContext.createOscillator();
  referenceGain = audioContext.createGain();
  referenceOscillator.type = "sine";
  referenceOscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
  referenceGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  referenceGain.gain.exponentialRampToValueAtTime(0.24, audioContext.currentTime + 0.03);
  referenceGain.gain.setTargetAtTime(0.0001, audioContext.currentTime + 1.25, 0.08);
  referenceOscillator.connect(referenceGain);
  referenceGain.connect(audioContext.destination);
  referenceOscillator.start();
  referenceOscillator.stop(audioContext.currentTime + 1.8);
  referenceOscillator.addEventListener("ended", () => {
    referenceOscillator = null;
    referenceGain = null;
    if (!isTunerRunning) {
      centDiff.textContent = "Reference tones work without the mic";
    }
  });
}

bpmInput.addEventListener("input", () => setBpm(bpmInput.value));
decreaseBpm.addEventListener("click", () => setBpm(currentBpm - 1));
increaseBpm.addEventListener("click", () => setBpm(currentBpm + 1));
startButton.addEventListener("click", startMetronome);
stopButton.addEventListener("click", stopMetronome);

document.querySelectorAll("[data-bpm]").forEach((button) => {
  button.addEventListener("click", () => setBpm(button.dataset.bpm));
});

document.querySelectorAll("[data-note]").forEach((button) => {
  button.addEventListener("click", () => {
    playReferenceTone(button.dataset.note, Number(button.dataset.frequency));
  });
});

tunerButton.addEventListener("click", async () => {
  if (isTunerRunning) {
    stopTuner();
  } else {
    await startTuner();
  }
});

window.addEventListener("pagehide", () => {
  stopMetronome();
  stopReferenceTone();
  if (isTunerRunning) stopTuner();
});

setBpm(currentBpm);
