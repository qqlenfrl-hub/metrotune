const bpmInput = document.querySelector("#bpmInput");
const bpmSlider = document.querySelector("#bpmSlider");
const startButton = document.querySelector("#startButton");
const beatCount = document.querySelector("#beatCount");
const beatsSelect = document.querySelector("#beatsSelect");
const pendulum = document.querySelector("#pendulum");
const tunerButton = document.querySelector("#tunerButton");
const noteName = document.querySelector("#noteName");
const frequency = document.querySelector("#frequency");
const tunerNeedle = document.querySelector("#tunerNeedle");

let audioContext;
let timerId;
let isRunning = false;
let currentBeat = 0;
let swingSide = false;

let tunerStream;
let tunerSource;
let analyser;
let tunerAnimation;
let isTunerRunning = false;

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // The app still works when opened from file:// or an unsupported browser.
    });
  });
}

function clampBpm(value) {
  return Math.min(240, Math.max(30, Number(value) || 120));
}

function syncBpm(value) {
  const bpm = clampBpm(value);
  bpmInput.value = bpm;
  bpmSlider.value = bpm;

  if (isRunning) {
    stopMetronome();
    startMetronome();
  }
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playClick(accent = false) {
  const ctx = ensureAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(accent ? 1320 : 880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.34 : 0.22, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
}

function tick() {
  const beatsPerBar = Number(beatsSelect.value);
  currentBeat = (currentBeat % beatsPerBar) + 1;
  beatCount.textContent = currentBeat;
  playClick(currentBeat === 1);

  swingSide = !swingSide;
  pendulum.classList.add("running");
  pendulum.classList.toggle("left", !swingSide);
  pendulum.classList.toggle("right", swingSide);
}

function startMetronome() {
  const interval = 60000 / clampBpm(bpmInput.value);
  isRunning = true;
  currentBeat = 0;
  startButton.textContent = "Stop";
  startButton.classList.add("active");
  tick();
  timerId = window.setInterval(tick, interval);
}

function stopMetronome() {
  isRunning = false;
  window.clearInterval(timerId);
  startButton.textContent = "Start";
  startButton.classList.remove("active");
  pendulum.classList.remove("running", "right");
  pendulum.classList.add("left");
}

function frequencyToNote(freq) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const note = noteNames[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  const target = 440 * 2 ** ((midi - 69) / 12);
  const cents = 1200 * Math.log2(freq / target);
  return { note: `${note}${octave}`, cents };
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

  if (bestCorrelation > 0.88 && bestOffset > 0) {
    return sampleRate / bestOffset;
  }

  return -1;
}

function updateTuner() {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  const detected = autoCorrelate(buffer, audioContext.sampleRate);

  if (detected > 0) {
    const note = frequencyToNote(detected);
    const cents = Math.max(-50, Math.min(50, note.cents));
    const needlePosition = 50 + cents;

    noteName.textContent = note.note;
    frequency.textContent = `${detected.toFixed(1)} Hz`;
    tunerNeedle.style.left = `${needlePosition}%`;
  } else {
    frequency.textContent = "소리를 내보세요";
  }

  tunerAnimation = requestAnimationFrame(updateTuner);
}

async function startTuner() {
  try {
    const ctx = ensureAudioContext();
    tunerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tunerSource = ctx.createMediaStreamSource(tunerStream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    tunerSource.connect(analyser);

    isTunerRunning = true;
    tunerButton.textContent = "튜너 끄기";
    updateTuner();
  } catch (error) {
    noteName.textContent = "--";
    frequency.textContent = "마이크 권한 필요";
  }
}

function stopTuner() {
  isTunerRunning = false;
  cancelAnimationFrame(tunerAnimation);
  tunerStream?.getTracks().forEach((track) => track.stop());
  tunerStream = null;
  tunerSource = null;
  analyser = null;
  tunerButton.textContent = "튜너 켜기";
  noteName.textContent = "--";
  frequency.textContent = "마이크 대기";
  tunerNeedle.style.left = "50%";
}

bpmInput.addEventListener("change", () => syncBpm(bpmInput.value));
bpmSlider.addEventListener("input", () => syncBpm(bpmSlider.value));
beatsSelect.addEventListener("change", () => {
  currentBeat = 0;
  beatCount.textContent = "1";
});

document.querySelectorAll("[data-step]").forEach((button) => {
  button.addEventListener("click", () => {
    syncBpm(clampBpm(bpmInput.value) + Number(button.dataset.step));
  });
});

startButton.addEventListener("click", async () => {
  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  if (isRunning) {
    stopMetronome();
  } else {
    startMetronome();
  }
});

tunerButton.addEventListener("click", async () => {
  if (isTunerRunning) {
    stopTuner();
  } else {
    await startTuner();
  }
});
