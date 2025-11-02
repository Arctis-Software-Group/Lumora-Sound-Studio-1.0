const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;

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

function applyGraphSettings(nodes, context, options, isOffline = false) {
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
  applyParam(nodes.dryGain?.gain, lumoOn ? 0.42 : 1);
  applyParam(nodes.wetPreGain?.gain, lumoOn ? 1.15 : 0);
  applyParam(nodes.lumoDepthGain?.gain, lumoOn ? 1.25 : 0);
  applyParam(nodes.lumoSubEnhancer?.gain, lumoOn ? 7.2 : 0);
  applyParam(nodes.lumoLowShelf?.gain, lumoOn ? 8.4 : 0);
  applyParam(nodes.lumoMidBass?.gain, lumoOn ? 5.8 : 0);
  applyParam(nodes.lumoPresence?.gain, lumoOn ? 5.6 : 0);
  applyParam(nodes.lumoAir?.gain, lumoOn ? 4.8 : 0);
  applyParam(nodes.lumoReverb?.gain, lumoOn ? 0.35 : 0);

  const spatialOn = options.enableSpatial;
  const rotationSpeed = spatialOn ? options.spatialSpeed ?? 0.42 : 0.0001;
  const orbitDepth = spatialOn ? options.spatialDepth ?? 1.35 : 0;
  applyParam(nodes.spatialLFO?.frequency, rotationSpeed);
  applyParam(nodes.spatialLFODepth?.gain, orbitDepth);
  applyParam(nodes.spatialOrbitGainX?.gain, spatialOn ? options.spatialOrbitRadius ?? 1.85 : 0);
  applyParam(nodes.spatialOrbitGainZ?.gain, spatialOn ? options.spatialOrbitRadius ?? 1.85 : 0);
  applyParam(nodes.spatialOrbitLFOX?.frequency, rotationSpeed);
  applyParam(nodes.spatialOrbitLFOZ?.frequency, rotationSpeed);
  const verticalRate = spatialOn
    ? options.spatialVerticalRate ?? rotationSpeed * 0.85
    : 0.0001;
  applyParam(nodes.spatialElevation?.offset, spatialOn ? options.spatialElevation ?? 0.58 : 0);
  applyParam(nodes.spatialForwardOffset?.offset, spatialOn ? options.spatialFrontBias ?? -0.85 : 0);
  applyParam(nodes.spatialVerticalDepth?.gain, spatialOn ? options.spatialVerticalDepth ?? 0.52 : 0);
  applyParam(nodes.spatialVerticalLFO?.frequency, verticalRate);
  applyParam(nodes.spatialRearDepth?.gain, spatialOn ? options.spatialRearDepth ?? 0.65 : 0);
  applyParam(nodes.spatialRearLFO?.frequency, spatialOn ? rotationSpeed * 0.63 : 0.0001);
  if (!spatialOn) {
    applyParam(nodes.stereoPanner?.pan, 0);
  }

  applyParam(nodes.masterGain?.gain, options.masterGain ?? 0.95);
}

function createAudioGraph(context, buffer, options, { isOffline = false } = {}) {
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

  nodes.lumoReverb = context.createConvolver();
  const reverbLength = context.sampleRate * 0.8;
  const reverbBuffer = context.createBuffer(2, reverbLength, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = reverbBuffer.getChannelData(channel);
    for (let i = 0; i < reverbLength; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLength, 2.5);
    }
  }
  nodes.lumoReverb.buffer = reverbBuffer;

  nodes.lumoReverbGain = context.createGain();
  nodes.lumoReverbGain.gain.value = 0;

  nodes.wetPreGain.connect(nodes.lumoSubEnhancer);
  nodes.lumoSubEnhancer.connect(nodes.lumoLowShelf);
  nodes.lumoLowShelf.connect(nodes.lumoMidBass);
  nodes.lumoMidBass.connect(nodes.lumoPresence);
  nodes.lumoPresence.connect(nodes.lumoAir);
  nodes.lumoAir.connect(nodes.lumoDepthGain);

  nodes.lumoAir.connect(nodes.lumoReverb);
  nodes.lumoReverb.connect(nodes.lumoReverbGain);

  nodes.spatialPanner = context.createPanner();
  nodes.spatialPanner.panningModel = 'HRTF';
  nodes.spatialPanner.distanceModel = 'inverse';
  nodes.spatialPanner.refDistance = 1.0;
  nodes.spatialPanner.maxDistance = 35;
  nodes.spatialPanner.rolloffFactor = 1.15;
  nodes.spatialPanner.coneInnerAngle = 360;
  nodes.spatialPanner.coneOuterAngle = 0;

  nodes.stereoPanner = context.createStereoPanner();
  nodes.dryGain.connect(nodes.spatialPanner);
  nodes.lumoDepthGain.connect(nodes.spatialPanner);
  nodes.lumoReverbGain.connect(nodes.spatialPanner);
  nodes.spatialPanner.connect(nodes.stereoPanner);

  nodes.spatialLFO = context.createOscillator();
  nodes.spatialLFO.type = 'sine';
  nodes.spatialLFODepth = context.createGain();
  nodes.spatialLFODepth.gain.value = 0;
  nodes.spatialLFO.connect(nodes.spatialLFODepth);
  nodes.spatialLFODepth.connect(nodes.stereoPanner.pan);
  const rotationSpeed = options.spatialSpeed ?? 0.42;
  try {
    nodes.spatialLFO.frequency.value = rotationSpeed;
  } catch (error) {
    nodes.spatialLFO.frequency.setValueAtTime(rotationSpeed, 0);
  }
  nodes.spatialLFO.start(0);
  nodes.spatialOrbitGainX = context.createGain();
  nodes.spatialOrbitGainZ = context.createGain();
  const initialOrbitRadius = options.enableSpatial ? options.spatialOrbitRadius ?? 1.85 : 0;
  nodes.spatialOrbitGainX.gain.value = initialOrbitRadius;
  nodes.spatialOrbitGainZ.gain.value = initialOrbitRadius;

  nodes.spatialOrbitLFOX = context.createOscillator();
  nodes.spatialOrbitLFOX.type = 'sine';
  try {
    nodes.spatialOrbitLFOX.frequency.value = rotationSpeed;
  } catch (error) {
    nodes.spatialOrbitLFOX.frequency.setValueAtTime(rotationSpeed, 0);
  }
  nodes.spatialOrbitLFOX.connect(nodes.spatialOrbitGainX);
  nodes.spatialOrbitGainX.connect(nodes.spatialPanner.positionX);

  nodes.spatialOrbitLFOZ = context.createOscillator();
  const cosWave = context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
  nodes.spatialOrbitLFOZ.setPeriodicWave(cosWave);
  try {
    nodes.spatialOrbitLFOZ.frequency.value = rotationSpeed;
  } catch (error) {
    nodes.spatialOrbitLFOZ.frequency.setValueAtTime(rotationSpeed, 0);
  }
  nodes.spatialOrbitLFOZ.connect(nodes.spatialOrbitGainZ);
  nodes.spatialOrbitGainZ.connect(nodes.spatialPanner.positionZ);

  nodes.spatialForwardOffset = context.createConstantSource();
  nodes.spatialForwardOffset.offset.value = options.enableSpatial ? options.spatialFrontBias ?? -0.85 : 0;
  nodes.spatialForwardOffset.connect(nodes.spatialPanner.positionZ);

  nodes.spatialElevation = context.createConstantSource();
  nodes.spatialElevation.offset.value = options.enableSpatial ? options.spatialElevation ?? 0.58 : 0;
  nodes.spatialElevation.connect(nodes.spatialPanner.positionY);
  nodes.spatialElevation.start(0);

  nodes.spatialVerticalLFO = context.createOscillator();
  nodes.spatialVerticalLFO.type = 'sine';
  const verticalRate = options.spatialVerticalRate ?? rotationSpeed * 0.85;
  try {
    nodes.spatialVerticalLFO.frequency.value = verticalRate;
  } catch (error) {
    nodes.spatialVerticalLFO.frequency.setValueAtTime(verticalRate, 0);
  }
  nodes.spatialVerticalDepth = context.createGain();
  nodes.spatialVerticalDepth.gain.value = options.enableSpatial ? options.spatialVerticalDepth ?? 0.52 : 0;
  nodes.spatialVerticalLFO.connect(nodes.spatialVerticalDepth);
  nodes.spatialVerticalDepth.connect(nodes.spatialPanner.positionY);

  nodes.spatialRearLFO = context.createOscillator();
  nodes.spatialRearLFO.type = 'triangle';
  const rearRate = rotationSpeed * 0.63;
  try {
    nodes.spatialRearLFO.frequency.value = rearRate;
  } catch (error) {
    nodes.spatialRearLFO.frequency.setValueAtTime(rearRate, 0);
  }
  nodes.spatialRearDepth = context.createGain();
  nodes.spatialRearDepth.gain.value = options.enableSpatial ? options.spatialRearDepth ?? 0.65 : 0;
  nodes.spatialRearLFO.connect(nodes.spatialRearDepth);
  nodes.spatialRearDepth.connect(nodes.spatialPanner.positionZ);

  nodes.spatialForwardOffset.start(0);
  nodes.spatialOrbitLFOX.start(0);
  nodes.spatialOrbitLFOZ.start(0);
  nodes.spatialVerticalLFO.start(0);
  nodes.spatialRearLFO.start(0);
  if (isOffline) {
    const stopAt = options.bufferDuration ?? buffer.duration;
    try {
      nodes.spatialLFO.stop(stopAt + 0.1);
    } catch {
      /* noop */
    }
    try {
      nodes.spatialOrbitLFOX.stop(stopAt + 0.1);
      nodes.spatialOrbitLFOZ.stop(stopAt + 0.1);
      nodes.spatialElevation.stop(stopAt + 0.1);
      nodes.spatialForwardOffset.stop(stopAt + 0.1);
      nodes.spatialVerticalLFO.stop(stopAt + 0.1);
      nodes.spatialRearLFO.stop(stopAt + 0.1);
    } catch {
      /* noop */
    }
  }

  let postNode = nodes.stereoPanner;

  if (options.separation === 'vocals') {
    nodes.vocalHighpass = context.createBiquadFilter();
    nodes.vocalHighpass.type = 'highpass';
    nodes.vocalHighpass.frequency.value = 180;
    nodes.vocalHighpass.Q.value = 0.8;

    nodes.vocalLowpass = context.createBiquadFilter();
    nodes.vocalLowpass.type = 'lowpass';
    nodes.vocalLowpass.frequency.value = 7500;
    nodes.vocalLowpass.Q.value = 0.9;

    nodes.vocalBandpass1 = context.createBiquadFilter();
    nodes.vocalBandpass1.type = 'peaking';
    nodes.vocalBandpass1.frequency.value = 1200;
    nodes.vocalBandpass1.Q.value = 2.2;
    nodes.vocalBandpass1.gain.value = 6.5;

    nodes.vocalBandpass2 = context.createBiquadFilter();
    nodes.vocalBandpass2.type = 'peaking';
    nodes.vocalBandpass2.frequency.value = 2800;
    nodes.vocalBandpass2.Q.value = 2.4;
    nodes.vocalBandpass2.gain.value = 8.2;

    nodes.vocalBandpass3 = context.createBiquadFilter();
    nodes.vocalBandpass3.type = 'peaking';
    nodes.vocalBandpass3.frequency.value = 4500;
    nodes.vocalBandpass3.Q.value = 1.8;
    nodes.vocalBandpass3.gain.value = 5.8;

    postNode.connect(nodes.vocalHighpass);
    nodes.vocalHighpass.connect(nodes.vocalLowpass);
    nodes.vocalLowpass.connect(nodes.vocalBandpass1);
    nodes.vocalBandpass1.connect(nodes.vocalBandpass2);
    nodes.vocalBandpass2.connect(nodes.vocalBandpass3);
    postNode = nodes.vocalBandpass3;
  } else if (options.separation === 'instrumentals') {
    nodes.instrumentLowShelf = context.createBiquadFilter();
    nodes.instrumentLowShelf.type = 'lowshelf';
    nodes.instrumentLowShelf.frequency.value = 190;
    nodes.instrumentLowShelf.gain.value = 4.5;

    nodes.instrumentMidCut = context.createBiquadFilter();
    nodes.instrumentMidCut.type = 'peaking';
    nodes.instrumentMidCut.frequency.value = 2400;
    nodes.instrumentMidCut.Q.value = 2.6;
    nodes.instrumentMidCut.gain.value = -8.5;

    nodes.instrumentHighShelf = context.createBiquadFilter();
    nodes.instrumentHighShelf.type = 'highshelf';
    nodes.instrumentHighShelf.frequency.value = 4200;
    nodes.instrumentHighShelf.gain.value = 3.2;

    nodes.instrumentLowBoost = context.createBiquadFilter();
    nodes.instrumentLowBoost.type = 'peaking';
    nodes.instrumentLowBoost.frequency.value = 85;
    nodes.instrumentLowBoost.Q.value = 1.3;
    nodes.instrumentLowBoost.gain.value = 5.5;

    postNode.connect(nodes.instrumentLowShelf);
    nodes.instrumentLowShelf.connect(nodes.instrumentLowBoost);
    nodes.instrumentLowBoost.connect(nodes.instrumentMidCut);
    nodes.instrumentMidCut.connect(nodes.instrumentHighShelf);
    postNode = nodes.instrumentHighShelf;
  }

  nodes.masterGain = context.createGain();
  nodes.masterGain.gain.value = options.masterGain ?? 0.95;

  postNode.connect(nodes.masterGain);
  nodes.masterGain.connect(context.destination);

  applyGraphSettings(nodes, context, options, isOffline);

  return nodes;
}

function destroyGraph() {
  if (!state.graph?.nodes) return;
  const { nodes } = state.graph;
  try {
    nodes.source.onended = null;
    nodes.source.stop(0);
  } catch {
    /* noop */
  }
  try {
    nodes.spatialLFO?.stop(0);
  } catch {
    /* noop */
  }
  try {
    nodes.spatialOrbitLFOX?.stop(0);
    nodes.spatialOrbitLFOZ?.stop(0);
    nodes.spatialElevation?.stop(0);
    nodes.spatialForwardOffset?.stop(0);
    nodes.spatialVerticalLFO?.stop(0);
    nodes.spatialRearLFO?.stop(0);
  } catch {
    /* noop */
  }
  state.graph = null;
}

function getCurrentOptions(overrides = {}) {
  return {
    eqValues: [...state.eqValues],
    enableSpatial: state.spatialEnabled,
    enableLumo: state.lumoEnabled,
    spatialSpeed: 0.42,
    spatialDepth: 1.35,
    spatialOrbitRadius: 1.85,
    spatialElevation: 0.58,
    spatialFrontBias: -0.85,
    spatialVerticalDepth: 0.52,
    spatialVerticalRate: 0.36,
    spatialRearDepth: 0.65,
    masterGain: 0.95,
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
    const nodes = createAudioGraph(context, state.audioBuffer, options);
    state.graph = { nodes };

    state.startTime = context.currentTime - offset;
    state.pausedAt = 0;
    nodes.source.onended = () => {
      if (state.graph?.nodes === nodes) {
        handlePlaybackEnded();
      }
    };
    nodes.source.start(0, offset);
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
  const nodes = createAudioGraph(offlineContext, buffer, options, { isOffline: true });
  nodes.source.start(0);
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
        applyGraphSettings(state.graph.nodes, state.audioContext, getCurrentOptions());
      }
    });
  });
}

function setupToggles() {
  ui.spatialToggle.addEventListener('change', (event) => {
    state.spatialEnabled = event.target.checked;
    if (state.graph?.nodes && state.audioContext) {
      applyGraphSettings(state.graph.nodes, state.audioContext, getCurrentOptions());
    }
  });

  ui.lumoToggle.addEventListener('change', (event) => {
    state.lumoEnabled = event.target.checked;
    if (state.graph?.nodes && state.audioContext) {
      applyGraphSettings(state.graph.nodes, state.audioContext, getCurrentOptions());
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

function init() {
  updateFooterYear();
  setupNavigation();
  setupFileInput();
  setupTransport();
  setupEQControls();
  setupToggles();
  setupDownloadButtons();
  updateButtonStates();
  startProgressLoop();
}

init();
