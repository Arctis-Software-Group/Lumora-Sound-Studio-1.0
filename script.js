const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;

const SPEED_OF_SOUND = 343;
const HEIGHT_PROJECT_SCALE = 16;
const ROOM_BOUNDS = {
  x: [-3.5, 3.5],
  y: [0, 3.2],
  z: [-4.5, 2.5],
};
const DEFAULT_SOURCE_POSITION = { x: 0, y: 1.5, z: -1.8 };
const DEFAULT_LISTENER_POSITION = { x: 0, y: 1.6, z: 0 };
const DEFAULT_ORIENTATION = { yaw: 0, pitch: 0, roll: 0 };
const IMPULSE_METADATA_URL = 'assets/impulses/presets.json';
const HRTF_METADATA_URL = 'assets/hrtf/metadata.json';
const REVERB_CROSSFADE_TIME = 0.22;
const HRTF_CROSSFADE_TIME = 0.18;
const MAX_DOPPLER_SHIFT = 0.22;
const PREVIEW_SPEED = 0.6;

const ui = {
  fileInput: document.getElementById('fileInput'),
  uploadPanel: document.querySelector('.upload-panel'),
  fileName: document.querySelector('.file-name'),
  durationLabel: document.getElementById('durationLabel'),
  sampleRateLabel: document.getElementById('sampleRateLabel'),
  durationText: document.getElementById('totalTimeLabel'),
  currentTimeText: document.getElementById('currentTimeLabel'),
  timeline: document.getElementById('timelineProgress'),
  playButton: document.getElementById('playButton'),
  pauseButton: document.getElementById('pauseButton'),
  rewindButton: document.getElementById('rewindButton'),
  downloadProcessed: document.getElementById('downloadProcessed'),
  downloadVocals: document.getElementById('downloadVocals'),
  downloadInstrumentals: document.getElementById('downloadInstrumentals'),
  spatialToggle: document.getElementById('spatialToggle'),
  lumoToggle: document.getElementById('lumoToggle'),
  eqSliders: Array.from(document.querySelectorAll('.eq-slider input[type="range"]')),
  toast: document.getElementById('toast'),
  footerYear: document.getElementById('footerYear'),
  topBar: document.querySelector('.top-bar'),
  navToggle: document.querySelector('.nav-toggle'),
  navLinks: Array.from(document.querySelectorAll('.main-nav a')),
  ctaButtons: Array.from(document.querySelectorAll('.cta-scroll')),
  reverbPreset: document.getElementById('reverbPreset'),
  reverbDescription: document.getElementById('reverbDescription'),
  reverbEarly: document.getElementById('reverbEarly'),
  reverbMix: document.getElementById('reverbMix'),
  reverbDecay: document.getElementById('reverbDecay'),
  stereoWidth: document.getElementById('stereoWidth'),
  sliderValues: Array.from(document.querySelectorAll('.slider-value')),
  spaceCanvas: document.getElementById('spaceCanvas'),
  spaceMeta: document.getElementById('spaceMeta'),
  spacePreviewToggle: document.getElementById('spacePreviewToggle'),
  spaceReset: document.getElementById('spaceReset'),
  listenerYaw: document.getElementById('listenerYaw'),
  listenerPitch: document.getElementById('listenerPitch'),
  listenerRoll: document.getElementById('listenerRoll'),
  sourceHeight: document.getElementById('sourceHeight'),
};

const EQ_FREQUENCIES = [60, 170, 350, 1000, 3500, 10000];

const state = {
  audioContext: null,
  audioBuffer: null,
  graph: null,
  eqValues: EQ_FREQUENCIES.map(() => 0),
  spatialEnabled: true,
  lumoEnabled: true,
  startTime: 0,
  pausedAt: 0,
  isPlaying: false,
  rafId: null,
  fileName: '',
  toastTimer: null,
  assets: {
    impulses: {
      metadata: null,
      buffers: new Map(),
      lastPresetId: null,
      errorShown: false,
    },
    hrtf: {
      metadata: null,
      buffers: new Map(),
      errorShown: false,
    },
  },
  reverb: {
    presetId: 'concert-hall',
    earlyMix: 0.42,
    reverbMix: 0.6,
    decay: 1,
    stereoWidth: 1,
    preDelay: 0.032,
  },
  scene: {
    listener: {
      position: { ...DEFAULT_LISTENER_POSITION },
      orientation: { ...DEFAULT_ORIENTATION },
    },
    sources: [
      {
        id: 'primary',
        position: { ...DEFAULT_SOURCE_POSITION },
        velocity: { x: 0, y: 0, z: 0 },
        lastPosition: { ...DEFAULT_SOURCE_POSITION },
      },
    ],
  },
  preview: {
    enabled: false,
    storedSource: null,
    storedOrientation: null,
    phase: 0,
  },
  spaceView: {
    scale: 120,
    originX: 0,
    originY: 0,
    centerX: (ROOM_BOUNDS.x[0] + ROOM_BOUNDS.x[1]) / 2,
    centerZ: (ROOM_BOUNDS.z[0] + ROOM_BOUNDS.z[1]) / 2,
  },
  renderLoopId: null,
  canvasContext: null,
  lastFrameTime: 0,
  draggingPointerId: null,
  isDraggingSource: false,
};

function formatTime(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

function cloneVec3(vec) {
  return { x: vec.x, y: vec.y, z: vec.z };
}

function subtractVec3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function lengthVec3(vec) {
  return Math.hypot(vec.x, vec.y, vec.z);
}

function normalizeVec3(vec) {
  const len = lengthVec3(vec);
  if (!len) return { x: 0, y: 0, z: 0 };
  return { x: vec.x / len, y: vec.y / len, z: vec.z / len };
}

function dotVec3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function rotateYaw(vec, yaw) {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  return {
    x: vec.x * cosY + vec.z * sinY,
    y: vec.y,
    z: -vec.x * sinY + vec.z * cosY,
  };
}

function rotatePitch(vec, pitch) {
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  return {
    x: vec.x,
    y: vec.y * cosP - vec.z * sinP,
    z: vec.y * sinP + vec.z * cosP,
  };
}

function rotateRoll(vec, roll) {
  const cosR = Math.cos(roll);
  const sinR = Math.sin(roll);
  return {
    x: vec.x * cosR - vec.y * sinR,
    y: vec.x * sinR + vec.y * cosR,
    z: vec.z,
  };
}

function applyRotation(vec, yaw, pitch, roll) {
  let result = rotateYaw(vec, yaw);
  result = rotatePitch(result, pitch);
  result = rotateRoll(result, roll);
  return result;
}

function worldToListener(vec, yaw, pitch, roll) {
  let result = rotateRoll(vec, -roll);
  result = rotatePitch(result, -pitch);
  result = rotateYaw(result, -yaw);
  return result;
}

function getOrientationVectors(orientation) {
  const yaw = degToRad(orientation.yaw);
  const pitch = degToRad(orientation.pitch);
  const roll = degToRad(orientation.roll);
  const forward = applyRotation({ x: 0, y: 0, z: -1 }, yaw, pitch, roll);
  const up = applyRotation({ x: 0, y: 1, z: 0 }, yaw, pitch, roll);
  return { forward, up };
}

function computeDistanceGain(distance, { refDistance, maxDistance, rolloff }) {
  const clamped = clamp(distance, 0, maxDistance);
  if (clamped <= refDistance) return 1;
  const denominator = refDistance + rolloff * (clamped - refDistance);
  if (denominator <= 0) return 0;
  const gain = refDistance / denominator;
  return clamp(gain, 0, 1);
}

function showToast(message) {
  if (!ui.toast) return;
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }
  state.toastTimer = setTimeout(() => {
    ui.toast.classList.remove('is-visible');
  }, 3200);
}

function updateFooterYear() {
  if (ui.footerYear) {
    ui.footerYear.textContent = new Date().getFullYear();
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
}

async function decodeArrayBuffer(context, arrayBuffer) {
  if (!arrayBuffer) {
    throw new Error('No audio data to decode');
  }
  if (typeof context.decodeAudioData !== 'function') {
    throw new Error('decodeAudioData is not supported');
  }
  try {
    return await context.decodeAudioData(arrayBuffer.slice(0));
  } catch (error) {
    return await new Promise((resolve, reject) => {
      context.decodeAudioData(
        arrayBuffer.slice(0),
        (decoded) => resolve(decoded),
        (err) => reject(err || error || new Error('decodeAudioData failed'))
      );
    });
  }
}

async function loadImpulseMetadata() {
  if (state.assets.impulses.metadata) {
    return state.assets.impulses.metadata;
  }
  try {
    const metadata = await fetchJson(IMPULSE_METADATA_URL);
    state.assets.impulses.metadata = metadata;
    return metadata;
  } catch (error) {
    console.warn('Impulse metadata load failed', error);
    if (!state.assets.impulses.errorShown) {
      showToast('ルームプリセットの読み込みに失敗しました。代替リバーブで続行します。');
      state.assets.impulses.errorShown = true;
    }
    state.assets.impulses.metadata = { presets: [] };
    return state.assets.impulses.metadata;
  }
}

function resolveImpulseUrl(fileName) {
  const base = IMPULSE_METADATA_URL.slice(0, IMPULSE_METADATA_URL.lastIndexOf('/') + 1);
  return `${base}${fileName}`;
}

async function ensureImpulseArrayBuffer(presetId) {
  const metadata = await loadImpulseMetadata();
  const preset = metadata?.presets?.find((item) => item.id === presetId);
  if (!preset) {
    throw new Error(`Preset not found: ${presetId}`);
  }
  if (!state.assets.impulses.buffers.has(presetId)) {
    const url = resolveImpulseUrl(preset.file);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load IR ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    state.assets.impulses.buffers.set(presetId, arrayBuffer);
  }
  state.assets.impulses.lastPresetId = presetId;
  return state.assets.impulses.buffers.get(presetId);
}

function createFallbackImpulse(context) {
  const duration = 0.9;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (random() * 2 - 1) * Math.pow(1 - t, 3.2);
    }
  }
  return buffer;
}

async function decodeImpulseBuffer(context, presetId) {
  try {
    const arrayBuffer = await ensureImpulseArrayBuffer(presetId);
    return await decodeArrayBuffer(context, arrayBuffer);
  } catch (error) {
    console.warn('Falling back to procedural impulse', error);
    return createFallbackImpulse(context);
  }
}

async function loadHrtfMetadata() {
  if (state.assets.hrtf.metadata) {
    return state.assets.hrtf.metadata;
  }
  try {
    const metadata = await fetchJson(HRTF_METADATA_URL);
    state.assets.hrtf.metadata = metadata;
    return metadata;
  } catch (error) {
    console.warn('HRTF metadata load failed', error);
    if (!state.assets.hrtf.errorShown) {
      showToast('HRTF データの読み込みに失敗しました。ブラウザの HRTF を使用します。');
      state.assets.hrtf.errorShown = true;
    }
    state.assets.hrtf.metadata = { positions: [] };
    return state.assets.hrtf.metadata;
  }
}

function resolveHrtfUrl(fileName) {
  const base = HRTF_METADATA_URL.slice(0, HRTF_METADATA_URL.lastIndexOf('/') + 1);
  return `${base}${fileName}`;
}

async function ensureHrtfArrayBuffer(fileName) {
  if (!state.assets.hrtf.buffers.has(fileName)) {
    const url = resolveHrtfUrl(fileName);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load HRTF ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    state.assets.hrtf.buffers.set(fileName, arrayBuffer);
  }
  return state.assets.hrtf.buffers.get(fileName);
}

async function decodeHrtfStereoBuffer(context, fileName) {
  const arrayBuffer = await ensureHrtfArrayBuffer(fileName);
  return decodeArrayBuffer(context, arrayBuffer);
}

function splitStereoBuffer(context, buffer) {
  const left = context.createBuffer(1, buffer.length, buffer.sampleRate);
  const right = context.createBuffer(1, buffer.length, buffer.sampleRate);
  left.copyToChannel(buffer.getChannelData(0), 0);
  const rightChannel = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
  right.copyToChannel(rightChannel, 0);
  return { left, right };
}

function createReverbSlot(context) {
  const convolver = context.createConvolver();
  convolver.normalize = false;
  const gain = context.createGain();
  gain.gain.value = 0;
  return { convolver, gain, presetId: null, loading: null };
}

function createEarlyReflectionNetwork(context) {
  const input = context.createGain();
  const output = context.createGain();
  const diffusionGain = context.createGain();
  diffusionGain.gain.value = 0.12;

  const taps = [
    { delay: 0.012, gain: 0.58, cutoff: 4200 },
    { delay: 0.021, gain: 0.44, cutoff: 3200 },
    { delay: 0.033, gain: 0.36, cutoff: 2600 },
    { delay: 0.047, gain: 0.28, cutoff: 1800 },
  ];

  taps.forEach((tap) => {
    const delay = context.createDelay(0.2);
    delay.delayTime.value = tap.delay;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = tap.cutoff;
    const gain = context.createGain();
    gain.gain.value = tap.gain;
    input.connect(delay);
    delay.connect(filter);
    filter.connect(gain);
    gain.connect(output);
  });

  const feedbackDelay = context.createDelay(0.12);
  feedbackDelay.delayTime.value = 0.06;
  output.connect(diffusionGain);
  diffusionGain.connect(feedbackDelay);
  feedbackDelay.connect(input);

  return { input, output, diffusionGain };
}

async function createReverbStage(context, options) {
  const stage = {};
  stage.input = context.createGain();
  stage.output = context.createGain();
  stage.earlyNetwork = createEarlyReflectionNetwork(context);
  stage.input.connect(stage.earlyNetwork.input);
  stage.earlyMixGain = context.createGain();
  stage.earlyMixGain.gain.value = options.reverbEarly ?? 0.4;
  stage.earlyNetwork.output.connect(stage.earlyMixGain);
  stage.earlyMixGain.connect(stage.output);

  stage.preDelay = context.createDelay(1);
  stage.preDelay.delayTime.value = clamp(options.reverbPreDelay ?? 0.028, 0, 0.25);
  stage.input.connect(stage.preDelay);

  stage.lateBus = context.createGain();
  stage.lateBus.gain.value = clamp(options.reverbMix ?? 0.6, 0, 1.2);
  stage.lateSlots = [createReverbSlot(context), createReverbSlot(context)];
  stage.lateSlots.forEach((slot) => {
    stage.preDelay.connect(slot.convolver);
    slot.convolver.connect(slot.gain);
    slot.gain.connect(stage.lateBus);
  });
  stage.lateBus.connect(stage.output);

  stage.mix = clamp(options.reverbMix ?? 0.6, 0, 1.2);
  stage.decay = clamp(options.reverbDecay ?? 1, 0.2, 1.6);
  stage.currentPreset = null;
  stage.pendingPreset = null;

  stage.updateLateGains = () => {
    const now = context.currentTime;
    const target = clamp(stage.mix * stage.decay, 0, 1.5);
    stage.lateSlots.forEach((slot) => {
      const isActive = slot.presetId === stage.currentPreset;
      const goal = isActive ? target : 0;
      if (typeof slot.gain.gain.setTargetAtTime === 'function') {
        slot.gain.gain.setTargetAtTime(goal, now, 0.12);
      } else {
        slot.gain.gain.value = goal;
      }
    });
  };

  stage.setEarlyMix = (value) => {
    const now = context.currentTime;
    if (typeof stage.earlyMixGain.gain.setTargetAtTime === 'function') {
      stage.earlyMixGain.gain.setTargetAtTime(clamp(value, 0, 1.2), now, 0.08);
    } else {
      stage.earlyMixGain.gain.value = clamp(value, 0, 1.2);
    }
  };

  stage.setLateMix = (value) => {
    stage.mix = clamp(value, 0, 1.5);
    stage.updateLateGains();
  };

  stage.setDecay = (value) => {
    stage.decay = clamp(value, 0.2, 1.8);
    stage.updateLateGains();
  };

  stage.setPreDelay = (value) => {
    const target = clamp(value, 0, 0.25);
    if (stage.preDelay.delayTime && typeof stage.preDelay.delayTime.setTargetAtTime === 'function') {
      stage.preDelay.delayTime.setTargetAtTime(target, context.currentTime, 0.06);
    } else {
      stage.preDelay.delayTime.value = target;
    }
  };

  stage.setDiffusion = (value) => {
    const target = clamp(value, 0, 0.6);
    if (typeof stage.earlyNetwork.diffusionGain.gain.setTargetAtTime === 'function') {
      stage.earlyNetwork.diffusionGain.gain.setTargetAtTime(target, context.currentTime, 0.08);
    } else {
      stage.earlyNetwork.diffusionGain.gain.value = target;
    }
  };

  stage.loadPreset = async (presetId) => {
    if (!presetId) return;
    if (stage.currentPreset === presetId && !stage.pendingPreset) {
      stage.updateLateGains();
      return;
    }
    if (stage.pendingPreset === presetId) return;
    stage.pendingPreset = presetId;
    try {
      const impulse = await decodeImpulseBuffer(context, presetId);
      const slot = stage.lateSlots.find((s) => s.presetId !== presetId) || stage.lateSlots[0];
      slot.convolver.buffer = impulse;
      slot.presetId = presetId;
      const now = context.currentTime;
      const target = clamp(stage.mix * stage.decay, 0, 1.5);
      stage.lateSlots.forEach((s) => {
        const goal = s.presetId === presetId ? target : 0;
        if (typeof s.gain.gain.setTargetAtTime === 'function') {
          s.gain.gain.setTargetAtTime(goal, now, REVERB_CROSSFADE_TIME);
        } else {
          s.gain.gain.value = goal;
        }
      });
      stage.currentPreset = presetId;
    } catch (error) {
      console.warn('Failed to load reverb preset', error);
    } finally {
      stage.pendingPreset = null;
    }
  };

  stage.disconnect = () => {
    stage.input.disconnect();
    stage.output.disconnect();
  };

  stage.updateLateGains();

  if (options.reverbPresetId) {
    await stage.loadPreset(options.reverbPresetId);
  }

  return stage;
}

function createStereoWidthStage(context, initialWidth = 1) {
  const input = context.createGain();
  const splitter = context.createChannelSplitter(2);
  input.connect(splitter);

  const midSumA = context.createGain();
  const midSumB = context.createGain();
  midSumA.gain.value = 0.5;
  midSumB.gain.value = 0.5;
  splitter.connect(midSumA, 0);
  splitter.connect(midSumB, 1);
  const midGain = context.createGain();
  midSumA.connect(midGain);
  midSumB.connect(midGain);

  const sideSumA = context.createGain();
  const sideSumB = context.createGain();
  sideSumA.gain.value = 0.5;
  sideSumB.gain.value = -0.5;
  splitter.connect(sideSumA, 0);
  splitter.connect(sideSumB, 1);
  const sideGain = context.createGain();
  sideSumA.connect(sideGain);
  sideSumB.connect(sideGain);

  const merger = context.createChannelMerger(2);
  const leftSum = context.createGain();
  const rightSum = context.createGain();

  const midGainLeft = context.createGain();
  midGainLeft.gain.value = 1 / Math.SQRT2;
  const midGainRight = context.createGain();
  midGainRight.gain.value = 1 / Math.SQRT2;
  midGain.connect(midGainLeft);
  midGain.connect(midGainRight);

  const sideGainLeft = context.createGain();
  const sideGainRight = context.createGain();
  sideGain.connect(sideGainLeft);
  sideGain.connect(sideGainRight);

  midGainLeft.connect(leftSum);
  sideGainLeft.connect(leftSum);
  leftSum.connect(merger, 0, 0);

  midGainRight.connect(rightSum);
  sideGainRight.connect(rightSum);
  rightSum.connect(merger, 0, 1);

  const output = context.createGain();
  merger.connect(output);

  function setWidth(width, timeConstant = 0.08) {
    const target = clamp(width, 0, 1.8) / Math.SQRT2;
    const now = context.currentTime;
    if (typeof sideGainLeft.gain.setTargetAtTime === 'function') {
      sideGainLeft.gain.setTargetAtTime(target, now, timeConstant);
      sideGainRight.gain.setTargetAtTime(-target, now, timeConstant);
    } else {
      sideGainLeft.gain.value = target;
      sideGainRight.gain.value = -target;
    }
  }

  setWidth(initialWidth, 0.01);

  return { input, output, setWidth };
}

function createHrtfSlot(context) {
  const left = context.createConvolver();
  const right = context.createConvolver();
  left.normalize = false;
  right.normalize = false;
  const leftGain = context.createGain();
  const rightGain = context.createGain();
  leftGain.gain.value = 0;
  rightGain.gain.value = 0;
  return { left, right, leftGain, rightGain, key: null, loading: null };
}

function createSpatialStage(context) {
  const stage = {};
  stage.inputDry = context.createGain();
  stage.inputWet = context.createGain();
  stage.output = context.createGain();
  stage.bypassGain = context.createGain();
  stage.bypassGain.gain.value = 0;

  stage.distanceConfig = { refDistance: 1.1, maxDistance: 32, rolloff: 1.05 };
  stage.distanceDry = context.createGain();
  stage.distanceDry.gain.value = 1;
  stage.distanceWet = context.createGain();
  stage.distanceWet.gain.value = 1;

  stage.inputDry.connect(stage.distanceDry);
  stage.inputWet.connect(stage.distanceWet);

  stage.distanceDry.connect(stage.bypassGain);
  stage.distanceWet.connect(stage.bypassGain);
  stage.bypassGain.connect(stage.output);

  stage.panner = context.createPanner();
  stage.panner.panningModel = 'HRTF';
  stage.panner.distanceModel = 'inverse';
  stage.panner.refDistance = stage.distanceConfig.refDistance;
  stage.panner.maxDistance = stage.distanceConfig.maxDistance;
  stage.panner.rolloffFactor = stage.distanceConfig.rolloff;
  stage.panner.coneInnerAngle = 360;
  stage.panner.coneOuterAngle = 0;

  stage.pannerGain = context.createGain();
  stage.pannerGain.gain.value = 1;
  stage.distanceDry.connect(stage.panner);
  stage.distanceWet.connect(stage.panner);
  stage.panner.connect(stage.pannerGain);
  stage.pannerGain.connect(stage.output);

  stage.hrtfInput = context.createGain();
  stage.hrtfInput.channelCountMode = 'explicit';
  stage.hrtfInput.channelCount = 2;
  stage.distanceDry.connect(stage.hrtfInput);
  stage.distanceWet.connect(stage.hrtfInput);

  stage.hrtfSplitter = context.createChannelSplitter(2);
  stage.hrtfInput.connect(stage.hrtfSplitter);
  stage.hrtfSumA = context.createGain();
  stage.hrtfSumB = context.createGain();
  stage.hrtfSumA.gain.value = 0.5;
  stage.hrtfSumB.gain.value = 0.5;
  stage.hrtfSplitter.connect(stage.hrtfSumA, 0);
  stage.hrtfSplitter.connect(stage.hrtfSumB, 1);
  stage.hrtfMono = context.createGain();
  stage.hrtfSumA.connect(stage.hrtfMono);
  stage.hrtfSumB.connect(stage.hrtfMono);

  stage.hrtfSlots = [createHrtfSlot(context), createHrtfSlot(context)];
  stage.hrtfMerger = context.createChannelMerger(2);
  stage.hrtfSlots.forEach((slot) => {
    stage.hrtfMono.connect(slot.left);
    stage.hrtfMono.connect(slot.right);
    slot.left.connect(slot.leftGain);
    slot.right.connect(slot.rightGain);
    slot.leftGain.connect(stage.hrtfMerger, 0, 0);
    slot.rightGain.connect(stage.hrtfMerger, 0, 1);
  });

  stage.hrtfLevel = context.createGain();
  stage.hrtfLevel.gain.value = 0;
  stage.hrtfMerger.connect(stage.hrtfLevel);
  stage.hrtfLevel.connect(stage.output);

  stage.metadata = null;
  stage.hrtfEnabled = false;
  stage.spatialEnabled = true;
  stage.currentPosition = cloneVec3(DEFAULT_SOURCE_POSITION);
  stage.currentListener = {
    position: cloneVec3(DEFAULT_LISTENER_POSITION),
    orientation: { ...DEFAULT_ORIENTATION },
  };
  stage.lastTargets = [];

  stage.setMetadata = (metadata) => {
    stage.metadata = metadata;
    stage.hrtfEnabled = Boolean(metadata?.positions?.length);
    stage.updateRouting();
  };

  stage.updateRouting = () => {
    const now = context.currentTime;
    const bypassValue = stage.spatialEnabled ? 0 : 1;
    const hrtfActive = stage.spatialEnabled && stage.hrtfEnabled;
    if (typeof stage.bypassGain.gain.setTargetAtTime === 'function') {
      stage.bypassGain.gain.setTargetAtTime(bypassValue, now, 0.08);
      stage.pannerGain.gain.setTargetAtTime(stage.spatialEnabled && !hrtfActive ? 1 : 0, now, 0.08);
      stage.hrtfLevel.gain.setTargetAtTime(hrtfActive ? 1 : 0, now, 0.08);
    } else {
      stage.bypassGain.gain.value = bypassValue;
      stage.pannerGain.gain.value = stage.spatialEnabled && !hrtfActive ? 1 : 0;
      stage.hrtfLevel.gain.value = hrtfActive ? 1 : 0;
    }
  };

  stage.setSpatialEnabled = (enabled) => {
    stage.spatialEnabled = Boolean(enabled);
    stage.updateRouting();
  };

  stage.setDistanceGain = (gainValue) => {
    const dry = clamp(gainValue, 0, 1);
    const wet = clamp(lerp(0.35, 1, dry), 0, 1);
    const now = context.currentTime;
    if (typeof stage.distanceDry.gain.setTargetAtTime === 'function') {
      stage.distanceDry.gain.setTargetAtTime(dry, now, 0.08);
      stage.distanceWet.gain.setTargetAtTime(wet, now, 0.1);
    } else {
      stage.distanceDry.gain.value = dry;
      stage.distanceWet.gain.value = wet;
    }
  };

  stage.setPosition = (position) => {
    stage.currentPosition = cloneVec3(position);
    const values = [position.x, position.y, position.z];
    const params = ['positionX', 'positionY', 'positionZ'];
    const now = context.currentTime;
    params.forEach((paramName, index) => {
      const param = stage.panner[paramName];
      if (param && typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(values[index], now, 0.08);
      } else if (typeof stage.panner[`position${'XYZ'[index]}`] === 'number') {
        stage.panner[`position${'XYZ'[index]}`] = values[index];
      }
    });
  };

  stage.setListenerState = (listenerState) => {
    stage.currentListener = {
      position: cloneVec3(listenerState.position),
      orientation: { ...listenerState.orientation },
    };
  };

  stage.loadSlot = async (slot, key) => {
    if (!key) return null;
    if (slot.key === key && slot.left.buffer) return slot;
    if (slot.loading) {
      try {
        await slot.loading;
      } catch {
        /* ignore */
      }
    }
    slot.loading = (async () => {
      try {
        const stereo = await decodeHrtfStereoBuffer(context, key);
        const { left, right } = splitStereoBuffer(context, stereo);
        slot.left.buffer = left;
        slot.right.buffer = right;
        slot.key = key;
      } catch (error) {
        console.warn('Failed to load HRTF slot', error);
        slot.left.buffer = null;
        slot.right.buffer = null;
        slot.key = null;
        stage.hrtfEnabled = false;
      } finally {
        slot.loading = null;
        stage.updateRouting();
      }
    })();
    await slot.loading;
    return slot;
  };

  stage.updateHrtfTargets = async (targets) => {
    if (!targets.length) {
      stage.lastTargets = [];
      stage.hrtfEnabled = false;
      stage.updateRouting();
      const now = context.currentTime;
      stage.hrtfSlots.forEach((slot) => {
        if (typeof slot.leftGain.gain.setTargetAtTime === 'function') {
          slot.leftGain.gain.setTargetAtTime(0, now, HRTF_CROSSFADE_TIME);
          slot.rightGain.gain.setTargetAtTime(0, now, HRTF_CROSSFADE_TIME);
        } else {
          slot.leftGain.gain.value = 0;
          slot.rightGain.gain.value = 0;
        }
      });
      return;
    }

    stage.hrtfEnabled = true;
    stage.updateRouting();

    const assigned = new Set();
    for (const target of targets) {
      let slot = stage.hrtfSlots.find((s) => s.key === target.key);
      if (!slot) {
        slot = stage.hrtfSlots.find((s) => !assigned.has(s)) || stage.hrtfSlots[0];
        await stage.loadSlot(slot, target.key);
      }
      assigned.add(slot);
    }

    const now = context.currentTime;
    stage.hrtfSlots.forEach((slot) => {
      const target = targets.find((t) => t.key === slot.key);
      const weight = target ? target.weight : 0;
      if (typeof slot.leftGain.gain.setTargetAtTime === 'function') {
        slot.leftGain.gain.setTargetAtTime(weight, now, HRTF_CROSSFADE_TIME);
        slot.rightGain.gain.setTargetAtTime(weight, now, HRTF_CROSSFADE_TIME);
      } else {
        slot.leftGain.gain.value = weight;
        slot.rightGain.gain.value = weight;
      }
    });

    stage.lastTargets = targets.map((target) => ({ ...target }));
  };

  stage.dispose = () => {
    stage.inputDry.disconnect();
    stage.inputWet.disconnect();
    stage.output.disconnect();
  };

  stage.updateRouting();

  return stage;
}

function computeSourceAngles(listenerState, sourcePosition) {
  const yaw = degToRad(listenerState.orientation.yaw);
  const pitch = degToRad(listenerState.orientation.pitch);
  const roll = degToRad(listenerState.orientation.roll);
  const relative = subtractVec3(sourcePosition, listenerState.position);
  const listenerSpace = worldToListener(relative, yaw, pitch, roll);
  const azimuth = radToDeg(Math.atan2(listenerSpace.x, -listenerSpace.z));
  const elevation = radToDeg(
    Math.atan2(listenerSpace.y, Math.hypot(listenerSpace.x, listenerSpace.z) || 1e-6)
  );
  return { azimuth, elevation };
}

function normalizeAzimuth(angle) {
  let result = angle % 360;
  if (result < -180) result += 360;
  if (result > 180) result -= 360;
  return result;
}

function computeHrtfTargets(metadata, angles) {
  const positions = metadata?.positions ?? [];
  if (!positions.length) return [];
  const normalizedAz = normalizeAzimuth(angles.azimuth);
  const normalizedEl = clamp(angles.elevation, -50, 90);
  const scored = positions.map((pos) => {
    const azDiffRaw = normalizeAzimuth(normalizedAz - pos.azimuth);
    const azDiff = Math.abs(azDiffRaw) / 180;
    const elDiff = (normalizedEl - pos.elevation) / 90;
    const dist = Math.hypot(azDiff, elDiff);
    return {
      key: pos.file,
      weight: 0,
      dist,
      pos,
    };
  });
  scored.sort((a, b) => a.dist - b.dist);
  const first = scored[0];
  const second = scored[1];
  if (!first) return [];
  if (!second || second.dist === 0 || first.dist === 0) {
    return [
      {
        key: first.key,
        weight: 1,
        pos: first.pos,
      },
    ];
  }
  const invA = 1 / (first.dist + 1e-6);
  const invB = 1 / (second.dist + 1e-6);
  const sum = invA + invB;
  return [
    { key: first.key, weight: invA / sum, pos: first.pos },
    { key: second.key, weight: invB / sum, pos: second.pos },
  ];
}

function setAudioListenerState(context, listenerState) {
  if (!context?.listener) return;
  const listener = context.listener;
  const { position, orientation } = listenerState;
  const { forward, up } = getOrientationVectors(orientation);
  const time = context.currentTime ?? 0;

  try {
    if (listener.positionX && typeof listener.positionX.setValueAtTime === 'function') {
      listener.positionX.setValueAtTime(position.x, time);
      listener.positionY.setValueAtTime(position.y, time);
      listener.positionZ.setValueAtTime(position.z, time);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(position.x, position.y, position.z);
    }
  } catch {
    /* noop */
  }

  try {
    if (listener.forwardX && typeof listener.forwardX.setValueAtTime === 'function') {
      listener.forwardX.setValueAtTime(forward.x, time);
      listener.forwardY.setValueAtTime(forward.y, time);
      listener.forwardZ.setValueAtTime(forward.z, time);
      listener.upX.setValueAtTime(up.x, time);
      listener.upY.setValueAtTime(up.y, time);
      listener.upZ.setValueAtTime(up.z, time);
    } else if (typeof listener.setOrientation === 'function') {
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  } catch {
    /* noop */
  }
}

function cancelProgressLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

function startProgressLoop() {
  cancelProgressLoop();
  const loop = () => {
    if (!state.audioBuffer) {
      ui.timeline.style.width = '0%';
      ui.currentTimeText.textContent = '0:00';
      state.rafId = requestAnimationFrame(loop);
      return;
    }

    let elapsed = state.pausedAt;
    if (state.isPlaying && state.audioContext) {
      elapsed = state.audioContext.currentTime - state.startTime;
    }
    elapsed = clamp(elapsed, 0, state.audioBuffer.duration);

    const progress = state.audioBuffer.duration ? elapsed / state.audioBuffer.duration : 0;
    ui.timeline.style.width = `${Math.min(progress * 100, 100)}%`;
    ui.currentTimeText.textContent = formatTime(elapsed);
    ui.durationText.textContent = formatTime(state.audioBuffer.duration);
    state.rafId = requestAnimationFrame(loop);
  };
  loop();
}

async function ensureAudioContext() {
  if (!AudioContextClass) {
    throw new Error('お使いのブラウザは Web Audio API に対応していません');
  }
  if (!state.audioContext) {
    state.audioContext = new AudioContextClass();
  }
  if (state.audioContext.state === 'suspended') {
    await state.audioContext.resume();
  }
  return state.audioContext;
}

function applyGraphSettings(graph, context, options, isOffline = false) {
  if (!graph?.nodes) return;
  const { nodes, reverbStage, stereoStage, spatialStage } = graph;
  const applyParam = (param, value) => {
    if (!param) return;
    try {
      if (isOffline) {
        if (typeof param.setValueAtTime === 'function') {
          param.setValueAtTime(value, 0);
        } else {
          param.value = value;
        }
      } else if (typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(value, context.currentTime, 0.05);
      } else if (typeof param.setValueAtTime === 'function') {
        param.setValueAtTime(value, context.currentTime);
      } else {
        param.value = value;
      }
    } catch {
      if ('value' in param) {
        param.value = value;
      }
    }
  };

  nodes.eqFilters?.forEach((filter, index) => {
    const gain = options.eqValues?.[index] ?? 0;
    applyParam(filter.gain, clamp(gain, -12, 12));
  });

  const lumoOn = options.enableLumo;
  applyParam(nodes.dryGain?.gain, lumoOn ? 0.48 : 1);
  applyParam(nodes.wetPreGain?.gain, lumoOn ? 1.1 : 0.7);
  applyParam(nodes.lumoDepthGain?.gain, lumoOn ? 1.24 : 0.85);
  applyParam(nodes.lumoSubEnhancer?.gain, lumoOn ? 7.2 : 0);
  applyParam(nodes.lumoLowShelf?.gain, lumoOn ? 8.4 : 0);
  applyParam(nodes.lumoMidBass?.gain, lumoOn ? 5.8 : 0);
  applyParam(nodes.lumoPresence?.gain, lumoOn ? 5.6 : 0);
  applyParam(nodes.lumoAir?.gain, lumoOn ? 4.8 : 0);

  if (reverbStage) {
    reverbStage.setEarlyMix(options.reverbEarly ?? state.reverb.earlyMix);
    reverbStage.setLateMix(options.reverbMix ?? state.reverb.reverbMix);
    reverbStage.setDecay(options.reverbDecay ?? state.reverb.decay);
    reverbStage.setPreDelay(options.reverbPreDelay ?? state.reverb.preDelay);
  }

  if (stereoStage) {
    stereoStage.setWidth(options.stereoWidth ?? state.reverb.stereoWidth ?? 1);
  }

  if (spatialStage) {
    spatialStage.setSpatialEnabled(options.enableSpatial);
  }

  applyParam(nodes.masterGain?.gain, options.masterGain ?? 0.95);
}

async function createAudioGraph(context, buffer, options, { isOffline = false } = {}) {
  const nodes = {};

  nodes.source = context.createBufferSource();
  nodes.source.buffer = buffer;

  nodes.inputGain = context.createGain();
  nodes.source.connect(nodes.inputGain);

  let lastNode = nodes.inputGain;

  nodes.eqFilters = EQ_FREQUENCIES.map((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = frequency >= 1000 ? 1.4 : 1.2;
    filter.gain.value = options.eqValues?.[index] ?? 0;
    lastNode.connect(filter);
    lastNode = filter;
    return filter;
  });

  nodes.dryGain = context.createGain();
  nodes.wetPreGain = context.createGain();
  lastNode.connect(nodes.dryGain);
  lastNode.connect(nodes.wetPreGain);

  nodes.lumoSubEnhancer = context.createBiquadFilter();
  nodes.lumoSubEnhancer.type = 'peaking';
  nodes.lumoSubEnhancer.frequency.value = 62;
  nodes.lumoSubEnhancer.Q.value = 1.3;
  nodes.lumoSubEnhancer.gain.value = 0;

  nodes.lumoLowShelf = context.createBiquadFilter();
  nodes.lumoLowShelf.type = 'lowshelf';
  nodes.lumoLowShelf.frequency.value = 115;

  nodes.lumoMidBass = context.createBiquadFilter();
  nodes.lumoMidBass.type = 'peaking';
  nodes.lumoMidBass.frequency.value = 280;
  nodes.lumoMidBass.Q.value = 1.4;
  nodes.lumoMidBass.gain.value = 0;

  nodes.lumoPresence = context.createBiquadFilter();
  nodes.lumoPresence.type = 'peaking';
  nodes.lumoPresence.frequency.value = 3400;
  nodes.lumoPresence.Q.value = 1.8;

  nodes.lumoAir = context.createBiquadFilter();
  nodes.lumoAir.type = 'highshelf';
  nodes.lumoAir.frequency.value = 12500;

  nodes.lumoDepthGain = context.createGain();

  nodes.wetPreGain.connect(nodes.lumoSubEnhancer);
  nodes.lumoSubEnhancer.connect(nodes.lumoLowShelf);
  nodes.lumoLowShelf.connect(nodes.lumoMidBass);
  nodes.lumoMidBass.connect(nodes.lumoPresence);
  nodes.lumoPresence.connect(nodes.lumoAir);
  nodes.lumoAir.connect(nodes.lumoDepthGain);

  const reverbStage = await createReverbStage(context, {
    reverbPresetId: options.reverbPresetId,
    reverbEarly: options.reverbEarly ?? state.reverb.earlyMix,
    reverbMix: options.reverbMix ?? state.reverb.reverbMix,
    reverbDecay: options.reverbDecay ?? state.reverb.decay,
    reverbPreDelay: options.reverbPreDelay ?? state.reverb.preDelay,
  });
  nodes.lumoAir.connect(reverbStage.input);

  const spatialStage = createSpatialStage(context);
  const stereoStage = createStereoWidthStage(context, options.stereoWidth ?? state.reverb.stereoWidth ?? 1);

  nodes.dryGain.connect(spatialStage.inputDry);
  nodes.lumoDepthGain.connect(spatialStage.inputDry);
  reverbStage.output.connect(spatialStage.inputWet);

  spatialStage.output.connect(stereoStage.input);

  nodes.masterGain = context.createGain();
  nodes.masterGain.gain.value = options.masterGain ?? 0.95;
  stereoStage.output.connect(nodes.masterGain);
  nodes.masterGain.connect(context.destination);

  const graph = {
    nodes,
    reverbStage,
    stereoStage,
    spatialStage,
  };

  const listenerState = options.listener ?? {
    position: cloneVec3(DEFAULT_LISTENER_POSITION),
    orientation: { ...DEFAULT_ORIENTATION },
  };
  const sourcePosition = options.sourcePosition
    ? cloneVec3(options.sourcePosition)
    : cloneVec3(DEFAULT_SOURCE_POSITION);

  spatialStage.setListenerState(listenerState);
  spatialStage.setPosition(sourcePosition);
  setAudioListenerState(context, listenerState);

  const hrtfMetadata = await loadHrtfMetadata();
  spatialStage.setMetadata(hrtfMetadata);

  const distanceVec = subtractVec3(sourcePosition, listenerState.position);
  const distance = lengthVec3(distanceVec);
  spatialStage.setDistanceGain(computeDistanceGain(distance, spatialStage.distanceConfig));

  if (spatialStage.hrtfEnabled && options.enableSpatial) {
    const angles = computeSourceAngles(listenerState, sourcePosition);
    const targets = computeHrtfTargets(hrtfMetadata, angles);
    if (targets.length) {
      await spatialStage.updateHrtfTargets(targets);
    }
  } else {
    await spatialStage.updateHrtfTargets([]);
  }

  applyGraphSettings(graph, context, options, isOffline);

  return graph;
}

function destroyGraph() {
  const graph = state.graph;
  if (!graph?.nodes) return;
  const { nodes, spatialStage } = graph;
  try {
    if (nodes.source) {
      nodes.source.onended = null;
      nodes.source.stop(0);
    }
  } catch {
    /* noop */
  }
  try {
    nodes.source?.disconnect();
  } catch {
    /* noop */
  }
  try {
    nodes.masterGain?.disconnect();
  } catch {
    /* noop */
  }
  try {
    spatialStage?.dispose?.();
  } catch {
    /* noop */
  }
  try {
    graph.reverbStage?.disconnect?.();
  } catch {
    /* noop */
  }
  state.graph = null;
}

function getCurrentOptions(overrides = {}) {
  const primarySource = state.scene.sources[0] ?? {
    position: cloneVec3(DEFAULT_SOURCE_POSITION),
  };
  return {
    eqValues: [...state.eqValues],
    enableSpatial: state.spatialEnabled,
    enableLumo: state.lumoEnabled,
    masterGain: 0.95,
    reverbPresetId: state.reverb.presetId,
    reverbEarly: state.reverb.earlyMix,
    reverbMix: state.reverb.reverbMix,
    reverbDecay: state.reverb.decay,
    reverbPreDelay: state.reverb.preDelay,
    stereoWidth: state.reverb.stereoWidth,
    listener: {
      position: cloneVec3(state.scene.listener.position),
      orientation: { ...state.scene.listener.orientation },
    },
    sourcePosition: cloneVec3(primarySource.position),
    bufferDuration: state.audioBuffer?.duration ?? 0,
    ...overrides,
  };
}

async function startPlayback(offset = 0) {
  if (!state.audioBuffer) {
    showToast('音声ファイルをアップロードしてください');
    return;
  }

  try {
    const context = await ensureAudioContext();
    destroyGraph();

    const options = getCurrentOptions();
    const graph = await createAudioGraph(context, state.audioBuffer, options, { isOffline: false });
    state.graph = graph;

    state.startTime = context.currentTime - offset;
    state.pausedAt = 0;
    graph.nodes.source.onended = () => {
      if (state.graph === graph) {
        handlePlaybackEnded();
      }
    };
    graph.nodes.source.start(0, offset);
    state.isPlaying = true;
    updateButtonStates();
    startProgressLoop();
  } catch (error) {
    console.error(error);
    showToast('再生を開始できませんでした');
  }
}

function pausePlayback() {
  if (!state.isPlaying || !state.audioContext || !state.graph?.nodes) return;
  const elapsed = state.audioContext.currentTime - state.startTime;
  state.pausedAt = clamp(elapsed, 0, state.audioBuffer?.duration ?? 0);
  state.isPlaying = false;
  destroyGraph();
  updateButtonStates();
}

function stopPlayback() {
  destroyGraph();
  state.isPlaying = false;
  state.pausedAt = 0;
  updateButtonStates();
}

function handlePlaybackEnded() {
  state.isPlaying = false;
  state.pausedAt = state.audioBuffer?.duration ?? 0;
  state.graph = null;
  ui.timeline.style.width = '100%';
  ui.currentTimeText.textContent = formatTime(state.pausedAt);
  updateButtonStates();
}

function updateButtonStates() {
  const hasAudio = Boolean(state.audioBuffer);
  ui.playButton.disabled = !hasAudio;
  ui.pauseButton.disabled = !state.isPlaying;
  ui.rewindButton.disabled = !hasAudio;
  ui.downloadProcessed.disabled = !hasAudio;
  ui.downloadVocals.disabled = !hasAudio;
  ui.downloadInstrumentals.disabled = !hasAudio;
}

function updateFileInfo(file) {
  const duration = state.audioBuffer?.duration ?? 0;
  const sampleRate = state.audioBuffer?.sampleRate ?? 0;
  ui.fileName.textContent = file ? file.name : '音声ファイルが選択されていません';
  ui.durationLabel.textContent = file ? `${formatTime(duration)} (${duration.toFixed(1)} 秒)` : '--:--';
  ui.sampleRateLabel.textContent = file ? `${Math.round(sampleRate)} Hz` : '-- Hz';
  ui.durationText.textContent = formatTime(duration);
  ui.currentTimeText.textContent = '0:00';
  ui.timeline.style.width = '0%';
  const info = document.querySelector('.file-info');
  if (file && info) {
    info.dataset.status = 'ready';
  }
}

async function decodeFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const context = await ensureAudioContext();
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
    state.audioBuffer = audioBuffer;
    state.fileName = file.name.replace(/\s+/g, '-').toLowerCase();
    state.pausedAt = 0;
    state.isPlaying = false;
    destroyGraph();
    updateFileInfo(file);
    updateButtonStates();
    startProgressLoop();
    showToast('音声ファイルを読み込みました');
  } catch (error) {
    console.error(error);
    showToast('音声ファイルの読み込みに失敗しました');
  }
}

function handleFileSelection(file) {
  if (!file) return;
  const isAudio = file.type.startsWith('audio/');
  if (!isAudio) {
    showToast('音声ファイルを選択してください');
    return;
  }
  decodeFile(file);
}

async function renderOffline(options) {
  if (!state.audioBuffer) {
    throw new Error('音声ファイルがロードされていません');
  }
  if (!OfflineAudioContextClass) {
    throw new Error('オフラインレンダリングに対応していないブラウザです');
  }
  const buffer = state.audioBuffer;
  const offlineContext = new OfflineAudioContextClass(2, buffer.length, buffer.sampleRate);
  const graph = await createAudioGraph(offlineContext, buffer, options, { isOffline: true });
  graph.nodes.source.start(0);
  const rendered = await offlineContext.startRendering();
  return rendered;
}

function audioBufferToWave(abuffer) {
  const numOfChan = abuffer.numberOfChannels;
  const sampleRate = abuffer.sampleRate;
  const formatLength = abuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(formatLength);
  const view = new DataView(buffer);
  let offset = 0;

  const writeString = (str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset++, str.charCodeAt(i));
    }
  };

  writeString('RIFF');
  view.setUint32(offset, formatLength - 8, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numOfChan, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * numOfChan * 2, true);
  offset += 4;
  view.setUint16(offset, numOfChan * 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, formatLength - 44, true);
  offset += 4;

  const channels = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(abuffer.getChannelData(i));
  }

  const interleaved = new Float32Array(abuffer.length * numOfChan);
  for (let i = 0; i < abuffer.length; i++) {
    for (let channel = 0; channel < numOfChan; channel++) {
      interleaved[i * numOfChan + channel] = channels[channel][i];
    }
  }

  let idx = 0;
  while (offset < formatLength) {
    const sample = clamp(interleaved[idx++], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

async function handleDownload(mode) {
  if (!state.audioBuffer) {
    showToast('先に音声ファイルを読み込んでください');
    return;
  }

  let toastMessage = 'レンダリングしています…';
  if (mode === 'processed') toastMessage = '効果音をレンダリング中…';
  if (mode === 'vocals') toastMessage = 'ボーカルを抽出中…';
  if (mode === 'instrumentals') toastMessage = '楽器パートを抽出中…';
  showToast(toastMessage);

  try {
    const options = getCurrentOptions();

    if (mode === 'vocals') {
      options.separation = 'vocals';
      options.enableSpatial = false;
      options.enableLumo = false;
    } else if (mode === 'instrumentals') {
      options.separation = 'instrumentals';
      options.enableSpatial = false;
      options.enableLumo = false;
    }

    const rendered = await renderOffline(options);
    const wavBuffer = audioBufferToWave(rendered);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = state.fileName ? state.fileName.replace(/\.[^/.]+$/, '') : 'lumora-audio';
    const suffix =
      mode === 'vocals' ? 'vocals' : mode === 'instrumentals' ? 'instrumentals' : 'processed';
    link.href = url;
    link.download = `${baseName}-${suffix}.wav`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('ダウンロードが完了しました');
  } catch (error) {
    console.error(error);
    showToast('ダウンロードに失敗しました');
  }
}

function updateSliderDisplay(id, value) {
  const target = document.querySelector(`.slider-value[data-slider="${id}"]`);
  if (!target) return;
  let text;
  switch (id) {
    case 'reverbEarly':
    case 'reverbMix':
      text = `${Math.round(value * 100)}%`;
      break;
    case 'reverbDecay':
      text = `${value.toFixed(2)}×`;
      break;
    case 'stereoWidth':
      text = `${Math.round(value * 100)}%`;
      break;
    case 'listenerYaw':
    case 'listenerPitch':
    case 'listenerRoll':
      text = `${Math.round(value)}°`;
      break;
    case 'sourceHeight':
      text = `${value.toFixed(2)} m`;
      break;
    default:
      text = `${value}`;
      break;
  }
  target.textContent = text;
}

function updateReverbDescription(preset) {
  if (!ui.reverbDescription) return;
  if (!preset) {
    ui.reverbDescription.textContent = 'プリセットを読み込んでください。';
    return;
  }
  const parts = [preset.description];
  if (typeof preset.decaySeconds === 'number') {
    parts.push(`残響: ${preset.decaySeconds.toFixed(2)} 秒`);
  }
  if (typeof preset.recommendedPreDelay === 'number') {
    parts.push(`プリディレイ: ${(preset.recommendedPreDelay * 1000).toFixed(0)} ms`);
  }
  ui.reverbDescription.textContent = parts.filter(Boolean).join(' / ');
}

async function populateReverbPresets() {
  if (!ui.reverbPreset) return null;
  const metadata = await loadImpulseMetadata();
  ui.reverbPreset.innerHTML = '';
  const presets = metadata?.presets ?? [];
  presets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    ui.reverbPreset.appendChild(option);
  });
  if (presets.length === 0) {
    ui.reverbPreset.disabled = true;
    updateReverbDescription(null);
    return metadata;
  }
  ui.reverbPreset.disabled = false;
  const current = presets.find((preset) => preset.id === state.reverb.presetId) || presets[0];
  if (current) {
    state.reverb.presetId = current.id;
    ui.reverbPreset.value = current.id;
    applyReverbPresetDefaults(current, { updateControls: false });
    updateReverbDescription(current);
  }
  return metadata;
}

function applyReverbPresetDefaults(preset, { updateControls = true } = {}) {
  if (!preset) return;
  state.reverb.presetId = preset.id;
  if (typeof preset.defaultEarlyMix === 'number') {
    state.reverb.earlyMix = preset.defaultEarlyMix;
  }
  if (typeof preset.defaultReverbMix === 'number') {
    state.reverb.reverbMix = preset.defaultReverbMix;
  }
  if (typeof preset.defaultWidth === 'number') {
    state.reverb.stereoWidth = preset.defaultWidth;
  }
  if (typeof preset.decaySeconds === 'number') {
    const normalizedDecay = clamp(preset.decaySeconds / 1.6, 0.4, 1.6);
    state.reverb.decay = normalizedDecay;
  }
  if (typeof preset.recommendedPreDelay === 'number') {
    state.reverb.preDelay = preset.recommendedPreDelay;
  }
  if (updateControls) {
    if (ui.reverbEarly) {
      ui.reverbEarly.value = state.reverb.earlyMix;
      updateSliderDisplay('reverbEarly', state.reverb.earlyMix);
    }
    if (ui.reverbMix) {
      ui.reverbMix.value = state.reverb.reverbMix;
      updateSliderDisplay('reverbMix', state.reverb.reverbMix);
    }
    if (ui.reverbDecay) {
      ui.reverbDecay.value = state.reverb.decay;
      updateSliderDisplay('reverbDecay', state.reverb.decay);
    }
    if (ui.stereoWidth) {
      ui.stereoWidth.value = state.reverb.stereoWidth;
      updateSliderDisplay('stereoWidth', state.reverb.stereoWidth);
    }
  }
}

async function setupReverbControls() {
  if (!ui.reverbPreset) return;
  const metadata = await populateReverbPresets();
  const presets = metadata?.presets ?? [];

  if (ui.reverbEarly) {
    ui.reverbEarly.value = state.reverb.earlyMix;
    updateSliderDisplay('reverbEarly', state.reverb.earlyMix);
    ui.reverbEarly.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      state.reverb.earlyMix = value;
      updateSliderDisplay('reverbEarly', value);
      if (state.graph?.reverbStage) {
        state.graph.reverbStage.setEarlyMix(value);
      }
      if (state.graph?.nodes && state.audioContext) {
        applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
      }
    });
  }

  if (ui.reverbMix) {
    ui.reverbMix.value = state.reverb.reverbMix;
    updateSliderDisplay('reverbMix', state.reverb.reverbMix);
    ui.reverbMix.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      state.reverb.reverbMix = value;
      updateSliderDisplay('reverbMix', value);
      if (state.graph?.reverbStage) {
        state.graph.reverbStage.setLateMix(value);
      }
      if (state.graph?.nodes && state.audioContext) {
        applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
      }
    });
  }

  if (ui.reverbDecay) {
    ui.reverbDecay.value = state.reverb.decay;
    updateSliderDisplay('reverbDecay', state.reverb.decay);
    ui.reverbDecay.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      state.reverb.decay = value;
      updateSliderDisplay('reverbDecay', value);
      if (state.graph?.reverbStage) {
        state.graph.reverbStage.setDecay(value);
      }
      if (state.graph?.nodes && state.audioContext) {
        applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
      }
    });
  }

  if (ui.stereoWidth) {
    ui.stereoWidth.value = state.reverb.stereoWidth;
    updateSliderDisplay('stereoWidth', state.reverb.stereoWidth);
    ui.stereoWidth.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      state.reverb.stereoWidth = value;
      updateSliderDisplay('stereoWidth', value);
      if (state.graph?.stereoStage) {
        state.graph.stereoStage.setWidth(value);
      }
      if (state.graph?.nodes && state.audioContext) {
        applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
      }
    });
  }

  if (ui.reverbPreset) {
    ui.reverbPreset.addEventListener('change', async (event) => {
      const presetId = event.target.value;
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;
      applyReverbPresetDefaults(preset, { updateControls: true });
      updateReverbDescription(preset);
      if (state.graph?.reverbStage) {
        await state.graph.reverbStage.loadPreset(preset.id);
      }
      if (state.graph?.nodes && state.audioContext) {
        applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
      }
    });
  }
}

function resizeSpaceCanvas() {
  if (!ui.spaceCanvas) return;
  const canvas = ui.spaceCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.canvasContext = ctx;

  const roomWidth = ROOM_BOUNDS.x[1] - ROOM_BOUNDS.x[0];
  const roomDepth = ROOM_BOUNDS.z[1] - ROOM_BOUNDS.z[0];
  const padding = 1.6;
  const scale = Math.min(
    rect.width / (roomWidth + padding),
    rect.height / (roomDepth + padding)
  );
  state.spaceView.scale = scale;
  state.spaceView.originX = rect.width / 2;
  state.spaceView.originY = rect.height * 0.75;
}

function updateSpaceMeta() {
  if (!ui.spaceMeta) return;
  const source = state.scene.sources[0];
  if (!source) return;
  ui.spaceMeta.textContent = `ソース X: ${source.position.x.toFixed(2)} m / Y: ${source.position.y.toFixed(
    2
  )} m / Z: ${source.position.z.toFixed(2)} m`;
}

function drawSpaceScene() {
  if (!ui.spaceCanvas || !state.canvasContext) return;
  const canvas = ui.spaceCanvas;
  const rect = canvas.getBoundingClientRect();
  const ctx = state.canvasContext;
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const { scale, originX, originY, centerX, centerZ } = state.spaceView;
  const project = (point) => ({
    x: originX + (point.x - centerX) * scale,
    y: originY + -(point.z - centerZ) * scale - point.y * HEIGHT_PROJECT_SCALE,
  });

  // grid lines
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(ROOM_BOUNDS.x[0]); x <= ROOM_BOUNDS.x[1]; x += 1) {
    const start = project({ x, y: ROOM_BOUNDS.y[0], z: ROOM_BOUNDS.z[0] });
    const end = project({ x, y: ROOM_BOUNDS.y[0], z: ROOM_BOUNDS.z[1] });
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  }
  for (let z = Math.ceil(ROOM_BOUNDS.z[0]); z <= ROOM_BOUNDS.z[1]; z += 1) {
    const start = project({ x: ROOM_BOUNDS.x[0], y: ROOM_BOUNDS.y[0], z });
    const end = project({ x: ROOM_BOUNDS.x[1], y: ROOM_BOUNDS.y[0], z });
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  }
  ctx.stroke();

  // room outline
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 2;
  const corners = [
    project({ x: ROOM_BOUNDS.x[0], y: ROOM_BOUNDS.y[0], z: ROOM_BOUNDS.z[0] }),
    project({ x: ROOM_BOUNDS.x[1], y: ROOM_BOUNDS.y[0], z: ROOM_BOUNDS.z[0] }),
    project({ x: ROOM_BOUNDS.x[1], y: ROOM_BOUNDS.y[0], z: ROOM_BOUNDS.z[1] }),
    project({ x: ROOM_BOUNDS.x[0], y: ROOM_BOUNDS.y[0], z: ROOM_BOUNDS.z[1] }),
  ];
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  });
  ctx.closePath();
  ctx.stroke();

  const source = state.scene.sources[0];
  if (source) {
    const projectedSource = project(source.position);
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(projectedSource.x, projectedSource.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(17, 17, 17, 0.28)';
    ctx.beginPath();
    const floorPoint = project({ x: source.position.x, y: ROOM_BOUNDS.y[0], z: source.position.z });
    ctx.moveTo(projectedSource.x, projectedSource.y);
    ctx.lineTo(floorPoint.x, floorPoint.y);
    ctx.stroke();
  }

  const listener = state.scene.listener;
  const listenerProjected = project(listener.position);
  ctx.fillStyle = '#ff5722';
  ctx.beginPath();
  ctx.arc(listenerProjected.x, listenerProjected.y, 9, 0, Math.PI * 2);
  ctx.fill();

  const { forward } = getOrientationVectors(listener.orientation);
  const arrowEnd = project({
    x: listener.position.x + forward.x * 1.2,
    y: listener.position.y + forward.y * 0.3,
    z: listener.position.z + forward.z * 1.2,
  });
  ctx.strokeStyle = '#ff5722';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(listenerProjected.x, listenerProjected.y);
  ctx.lineTo(arrowEnd.x, arrowEnd.y);
  ctx.stroke();

  // arrow head
  const arrowDir = normalizeVec3({ x: arrowEnd.x - listenerProjected.x, y: arrowEnd.y - listenerProjected.y, z: 0 });
  ctx.beginPath();
  ctx.moveTo(arrowEnd.x, arrowEnd.y);
  ctx.lineTo(arrowEnd.x - arrowDir.x * 8 - arrowDir.y * 5, arrowEnd.y - arrowDir.y * 8 + arrowDir.x * 5);
  ctx.lineTo(arrowEnd.x - arrowDir.x * 8 + arrowDir.y * 5, arrowEnd.y - arrowDir.y * 8 - arrowDir.x * 5);
  ctx.closePath();
  ctx.fill();

  updateSpaceMeta();
}

function updateSpatialStageForState() {
  if (!state.graph?.spatialStage) return;
  const stage = state.graph.spatialStage;
  const listener = state.scene.listener;
  const source = state.scene.sources[0];
  stage.setListenerState(listener);
  stage.setPosition(source.position);
  if (state.audioContext) {
    setAudioListenerState(state.audioContext, listener);
  }
  const distance = lengthVec3(subtractVec3(source.position, listener.position));
  stage.setDistanceGain(computeDistanceGain(distance, stage.distanceConfig));
  if (stage.hrtfEnabled && state.spatialEnabled) {
    const metadata = stage.metadata || state.assets.hrtf.metadata;
    const targets = computeHrtfTargets(metadata, computeSourceAngles(listener, source.position));
    if (targets.length) {
      stage.updateHrtfTargets(targets).catch(() => {});
    }
  }
}

function updateSceneDynamics(deltaTime) {
  const source = state.scene.sources[0];
  if (!source || !state.graph?.nodes) return;
  if (deltaTime > 0 && deltaTime < 0.25) {
    const velocity = {
      x: (source.position.x - source.lastPosition.x) / deltaTime,
      y: (source.position.y - source.lastPosition.y) / deltaTime,
      z: (source.position.z - source.lastPosition.z) / deltaTime,
    };
    source.velocity = velocity;
  }
  source.lastPosition = cloneVec3(source.position);

  updateSpatialStageForState();

  const playbackRateParam = state.graph.nodes.source?.playbackRate;
  if (playbackRateParam && state.audioContext) {
    const listener = state.scene.listener;
    const rel = subtractVec3(source.position, listener.position);
    const direction = normalizeVec3(rel);
    const radialVelocity = dotVec3(source.velocity, direction);
    const limited = clamp(radialVelocity, -SPEED_OF_SOUND * 0.45, SPEED_OF_SOUND * 0.45);
    const dopplerFactor = clamp(
      SPEED_OF_SOUND / (SPEED_OF_SOUND - limited || SPEED_OF_SOUND),
      1 - MAX_DOPPLER_SHIFT,
      1 + MAX_DOPPLER_SHIFT
    );
    if (typeof playbackRateParam.setTargetAtTime === 'function') {
      playbackRateParam.setTargetAtTime(dopplerFactor, state.audioContext.currentTime, 0.12);
    } else {
      playbackRateParam.value = dopplerFactor;
    }
  }
}

function updatePreviewMotion(deltaTime) {
  if (!state.preview.enabled) return;
  const source = state.scene.sources[0];
  if (!source) return;
  state.preview.phase += deltaTime * PREVIEW_SPEED;
  const radius = 1.6;
  source.position.x = DEFAULT_SOURCE_POSITION.x + Math.cos(state.preview.phase) * radius;
  source.position.z = DEFAULT_SOURCE_POSITION.z + Math.sin(state.preview.phase) * (radius * 0.8);
  source.position.y = clamp(
    DEFAULT_SOURCE_POSITION.y + Math.sin(state.preview.phase * 1.7) * 0.4,
    ROOM_BOUNDS.y[0],
    ROOM_BOUNDS.y[1]
  );
  state.scene.listener.orientation.yaw = clamp(Math.sin(state.preview.phase * 0.6) * 35, -90, 90);
  state.scene.listener.orientation.pitch = clamp(Math.sin(state.preview.phase * 0.4) * 12, -40, 40);

  if (ui.sourceHeight) {
    ui.sourceHeight.value = source.position.y;
    updateSliderDisplay('sourceHeight', source.position.y);
  }
  if (ui.listenerYaw) {
    ui.listenerYaw.value = state.scene.listener.orientation.yaw;
    updateSliderDisplay('listenerYaw', state.scene.listener.orientation.yaw);
  }
  if (ui.listenerPitch) {
    ui.listenerPitch.value = state.scene.listener.orientation.pitch;
    updateSliderDisplay('listenerPitch', state.scene.listener.orientation.pitch);
  }
  updateSpatialStageForState();
}

function startSpaceRenderLoop() {
  if (state.renderLoopId) {
    cancelAnimationFrame(state.renderLoopId);
  }
  const step = (timestamp) => {
    const now = timestamp / 1000;
    if (!state.lastFrameTime) {
      state.lastFrameTime = now;
    }
    const delta = clamp(now - state.lastFrameTime, 0, 0.1);
    state.lastFrameTime = now;
    updatePreviewMotion(delta);
    updateSceneDynamics(delta);
    drawSpaceScene();
    state.renderLoopId = requestAnimationFrame(step);
  };
  state.renderLoopId = requestAnimationFrame(step);
}

function resetSpaceState() {
  const source = state.scene.sources[0];
  if (source) {
    source.position = cloneVec3(DEFAULT_SOURCE_POSITION);
    source.lastPosition = cloneVec3(DEFAULT_SOURCE_POSITION);
    source.velocity = { x: 0, y: 0, z: 0 };
  }
  state.scene.listener.position = cloneVec3(DEFAULT_LISTENER_POSITION);
  state.scene.listener.orientation = { ...DEFAULT_ORIENTATION };
  if (ui.sourceHeight) {
    ui.sourceHeight.value = state.scene.sources[0].position.y;
    updateSliderDisplay('sourceHeight', state.scene.sources[0].position.y);
  }
  if (ui.listenerYaw) {
    ui.listenerYaw.value = state.scene.listener.orientation.yaw;
    updateSliderDisplay('listenerYaw', state.scene.listener.orientation.yaw);
  }
  if (ui.listenerPitch) {
    ui.listenerPitch.value = state.scene.listener.orientation.pitch;
    updateSliderDisplay('listenerPitch', state.scene.listener.orientation.pitch);
  }
  if (ui.listenerRoll) {
    ui.listenerRoll.value = state.scene.listener.orientation.roll;
    updateSliderDisplay('listenerRoll', state.scene.listener.orientation.roll);
  }
  updateSpatialStageForState();
  updateSpaceMeta();
}

function togglePreview(enabled) {
  if (enabled) {
    if (!state.preview.storedSource) {
      state.preview.storedSource = cloneVec3(state.scene.sources[0].position);
    }
    if (!state.preview.storedOrientation) {
      state.preview.storedOrientation = { ...state.scene.listener.orientation };
    }
    state.preview.enabled = true;
    if (ui.spacePreviewToggle) {
      ui.spacePreviewToggle.setAttribute('aria-pressed', 'true');
      ui.spacePreviewToggle.textContent = 'プレビュー停止';
    }
  } else {
    state.preview.enabled = false;
    if (ui.spacePreviewToggle) {
      ui.spacePreviewToggle.setAttribute('aria-pressed', 'false');
      ui.spacePreviewToggle.textContent = 'モーションプレビュー';
    }
    if (state.preview.storedSource) {
      state.scene.sources[0].position = cloneVec3(state.preview.storedSource);
      state.scene.sources[0].lastPosition = cloneVec3(state.preview.storedSource);
    }
    if (state.preview.storedOrientation) {
      state.scene.listener.orientation = { ...state.preview.storedOrientation };
    }
    state.preview.phase = 0;
    state.preview.storedSource = null;
    state.preview.storedOrientation = null;
    updateSpatialStageForState();
  }
}

function setupSpacePanel() {
  if (!ui.spaceCanvas) return;
  resizeSpaceCanvas();
  window.addEventListener('resize', resizeSpaceCanvas);

  const listener = state.scene.listener.orientation;
  if (ui.listenerYaw) {
    ui.listenerYaw.value = listener.yaw;
    updateSliderDisplay('listenerYaw', listener.yaw);
    ui.listenerYaw.addEventListener('input', (event) => {
      state.scene.listener.orientation.yaw = Number(event.target.value);
      updateSliderDisplay('listenerYaw', state.scene.listener.orientation.yaw);
      updateSpatialStageForState();
    });
  }
  if (ui.listenerPitch) {
    ui.listenerPitch.value = listener.pitch;
    updateSliderDisplay('listenerPitch', listener.pitch);
    ui.listenerPitch.addEventListener('input', (event) => {
      state.scene.listener.orientation.pitch = Number(event.target.value);
      updateSliderDisplay('listenerPitch', state.scene.listener.orientation.pitch);
      updateSpatialStageForState();
    });
  }
  if (ui.listenerRoll) {
    ui.listenerRoll.value = listener.roll;
    updateSliderDisplay('listenerRoll', listener.roll);
    ui.listenerRoll.addEventListener('input', (event) => {
      state.scene.listener.orientation.roll = Number(event.target.value);
      updateSliderDisplay('listenerRoll', state.scene.listener.orientation.roll);
      updateSpatialStageForState();
    });
  }

  if (ui.sourceHeight) {
    ui.sourceHeight.value = state.scene.sources[0].position.y;
    updateSliderDisplay('sourceHeight', state.scene.sources[0].position.y);
    ui.sourceHeight.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      state.scene.sources[0].position.y = clamp(value, ROOM_BOUNDS.y[0], ROOM_BOUNDS.y[1]);
      if (!state.isPlaying) {
        state.scene.sources[0].lastPosition = cloneVec3(state.scene.sources[0].position);
      }
      updateSliderDisplay('sourceHeight', state.scene.sources[0].position.y);
      updateSpaceMeta();
      updateSpatialStageForState();
    });
  }

  if (ui.spaceReset) {
    ui.spaceReset.addEventListener('click', () => {
      togglePreview(false);
      resetSpaceState();
    });
  }

  if (ui.spacePreviewToggle) {
    ui.spacePreviewToggle.addEventListener('click', () => {
      togglePreview(!state.preview.enabled);
    });
  }

  const handlePointer = (event) => {
    if (!ui.spaceCanvas || !state.canvasContext) return;
    const rect = ui.spaceCanvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    const { scale, originX, originY, centerX, centerZ } = state.spaceView;
    const currentHeight = state.scene.sources[0]?.position.y ?? DEFAULT_SOURCE_POSITION.y;
    const worldX = (canvasX - originX) / scale + centerX;
    const worldZ = -((canvasY - originY) / scale) + centerZ + (currentHeight * HEIGHT_PROJECT_SCALE) / scale;
    state.scene.sources[0].position.x = clamp(worldX, ROOM_BOUNDS.x[0], ROOM_BOUNDS.x[1]);
    state.scene.sources[0].position.z = clamp(worldZ, ROOM_BOUNDS.z[0], ROOM_BOUNDS.z[1]);
    if (!state.isPlaying) {
      state.scene.sources[0].lastPosition = cloneVec3(state.scene.sources[0].position);
    }
    updateSpaceMeta();
    if (!state.preview.enabled) {
      updateSpatialStageForState();
    }
  };

  // pointer handling
  const canvas = ui.spaceCanvas;
  const getProjectedSource = () => {
    const { scale, originX, originY, centerX, centerZ } = state.spaceView;
    const pos = state.scene.sources[0]?.position ?? DEFAULT_SOURCE_POSITION;
    return {
      x: originX + (pos.x - centerX) * scale,
      y: originY + -(pos.z - centerZ) * scale - pos.y * HEIGHT_PROJECT_SCALE,
    };
  };

  canvas.addEventListener('pointerdown', (event) => {
    const projected = getProjectedSource();
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const distance = Math.hypot(projected.x - x, projected.y - y);
    if (distance < 18) {
      state.isDraggingSource = true;
      state.draggingPointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      if (state.preview.enabled) {
        togglePreview(false);
      }
      handlePointer(event);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!state.isDraggingSource || state.draggingPointerId !== event.pointerId) return;
    handlePointer(event);
  });

  const stopDragging = (event) => {
    if (state.isDraggingSource && state.draggingPointerId === event.pointerId) {
      state.isDraggingSource = false;
      state.draggingPointerId = null;
      canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = 'grab';
    }
  };

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
    canvas.addEventListener(eventName, stopDragging);
  });

  updateSpaceMeta();
  drawSpaceScene();
  startSpaceRenderLoop();
}

function setupEQControls() {
  ui.eqSliders.forEach((slider, index) => {
    const valueLabel = slider.parentElement?.querySelector('.eq-value');
    slider.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      state.eqValues[index] = value;
      if (valueLabel) {
        const displayValue = Number.isInteger(value) ? value : value.toFixed(1);
        valueLabel.textContent = `${value > 0 ? '+' : ''}${displayValue} dB`;
      }
      if (state.graph?.nodes && state.audioContext) {
        applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
      }
    });
  });
}

function setupToggles() {
  ui.spatialToggle.addEventListener('change', (event) => {
    state.spatialEnabled = event.target.checked;
    if (state.graph?.nodes && state.audioContext) {
      applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
    }
  });

  ui.lumoToggle.addEventListener('change', (event) => {
    state.lumoEnabled = event.target.checked;
    if (state.graph?.nodes && state.audioContext) {
      applyGraphSettings(state.graph, state.audioContext, getCurrentOptions());
    }
  });
}

function setupTransport() {
  ui.playButton.addEventListener('click', () => {
    const offset = state.pausedAt || 0;
    startPlayback(offset);
  });

  ui.pauseButton.addEventListener('click', () => {
    pausePlayback();
  });

  ui.rewindButton.addEventListener('click', () => {
    stopPlayback();
    ui.timeline.style.width = '0%';
    ui.currentTimeText.textContent = '0:00';
  });
}

function setupDownloadButtons() {
  ui.downloadProcessed.addEventListener('click', () => handleDownload('processed'));
  ui.downloadVocals.addEventListener('click', () => handleDownload('vocals'));
  ui.downloadInstrumentals.addEventListener('click', () => handleDownload('instrumentals'));
}

function setupFileInput() {
  ui.fileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    handleFileSelection(file);
  });

  if (ui.uploadPanel) {
    ['dragenter', 'dragover'].forEach((eventName) => {
      ui.uploadPanel.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        ui.uploadPanel.classList.add('is-dragging');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      ui.uploadPanel.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        ui.uploadPanel.classList.remove('is-dragging');
      });
    });

    ui.uploadPanel.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      handleFileSelection(file);
    });
  }
}

function setupNavigation() {
  if (ui.navToggle) {
    ui.navToggle.addEventListener('click', () => {
      ui.topBar.classList.toggle('is-open');
    });
  }

  ui.navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          event.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      ui.topBar.classList.remove('is-open');
    });
  });

  ui.ctaButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const targetSelector = button.dataset.target;
      const target = targetSelector ? document.querySelector(targetSelector) : null;
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        ui.topBar.classList.remove('is-open');
      }
    });
  });
}

async function init() {
  updateFooterYear();
  setupNavigation();
  setupFileInput();
  setupTransport();
  setupEQControls();
  setupToggles();
  await setupReverbControls();
  setupSpacePanel();
  setupDownloadButtons();
  updateButtonStates();
  startProgressLoop();
}

init();
