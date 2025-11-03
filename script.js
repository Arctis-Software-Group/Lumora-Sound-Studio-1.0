// Audio Context
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;

// UI Elements
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

// Constants
const EQ_FREQUENCIES = [60, 170, 350, 1000, 3500, 10000];

// Application State
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

// Utility Functions
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
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    ui.toast.classList.remove('is-visible');
    state.toastTimer = null;
  }, 3000);
}

// Navigation Setup
function setupNavigation() {
  const navToggle = ui.navToggle;
  if (!navToggle) return;
  
  navToggle.addEventListener('click', () => {
    const mainNav = document.querySelector('.main-nav');
    if (mainNav) {
      mainNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', 
        mainNav.classList.contains('is-open') ? 'true' : 'false');
    }
  });
  
  ui.navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href.startsWith('#')) {
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
          const mainNav = document.querySelector('.main-nav');
          if (mainNav) mainNav.classList.remove('is-open');
        }
      }
    });
  });
}

// CTA Button Setup
function setupCTAButtons() {
  ui.ctaButtons.forEach(button => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-target');
      if (target) {
        const element = document.querySelector(target);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
}

// Audio Processing Functions
function initializeAudioContext() {
  if (state.audioContext) return state.audioContext;
  state.audioContext = new AudioContextClass();
  return state.audioContext;
}

async function processAudioFile(file) {
  try {
    showToast('ファイルを読み込み中...');
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = initializeAudioContext();
    state.audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    ui.fileName.textContent = file.name;
    state.fileName = file.name;
    
    const duration = state.audioBuffer.duration;
    ui.durationText.textContent = formatTime(duration);
    ui.sampleRateLabel.textContent = `サンプルレート: ${state.audioBuffer.sampleRate} Hz`;
    
    showToast('ファイルが読み込まれました。');
  } catch (error) {
    console.error('エラー:', error);
    showToast('ファイルの読み込みに失敗しました。');
  }
}

// Initialize
function init() {
  if (ui.footerYear) {
    ui.footerYear.textContent = new Date().getFullYear();
  }
  
  setupNavigation();
  setupCTAButtons();
  
  if (ui.fileInput) {
    ui.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) processAudioFile(file);
    });
  }
  
  // EQ Slider Setup
  ui.eqSliders.forEach((slider, index) => {
    slider.addEventListener('input', (e) => {
      state.eqValues[index] = parseFloat(e.target.value);
    });
  });
  
  // Toggle Setup
  if (ui.spatialToggle) {
    ui.spatialToggle.addEventListener('change', (e) => {
      state.spatialEnabled = e.target.checked;
      showToast(`16D音響: ${state.spatialEnabled ? '有効' : '無効'}`);
    });
  }
  
  if (ui.lumoToggle) {
    ui.lumoToggle.addEventListener('change', (e) => {
      state.lumoEnabled = e.target.checked;
      showToast(`Lumo音響: ${state.lumoEnabled ? '有効' : '無効'}`);
    });
  }
}

// Start Application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Prevent reload
window.addEventListener('beforeunload', (e) => {
  if (state.isPlaying) {
    e.preventDefault();
    e.returnValue = '';
  }
});
