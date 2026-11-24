import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ==========================================================================
   DOM References
   ========================================================================== */

const body = document.body;
const webglCanvas = document.getElementById('webgl-canvas');
const fxCanvas = document.getElementById('fx-canvas');
const fxCtx = fxCanvas.getContext('2d');

const loaderBar = document.getElementById('loader-bar');
const loaderPercent = document.getElementById('loader-percent');
const loaderStatus = document.getElementById('loader-status');

const rpmReadout = document.getElementById('rpm-readout');
const ritualMeterFill = document.getElementById('ritual-meter-fill');
const ritualHint = document.getElementById('ritual-hint');
const eclipseFlash = document.getElementById('eclipse-flash');

const posterStage = document.getElementById('poster-stage');
const posterCard = document.getElementById('poster-card');
const ritualHud = document.getElementById('ritual-hud');
const inspectHud = document.getElementById('inspect-hud');

const btnSound = document.getElementById('btn-sound');
const btnSkip = document.getElementById('btn-skip');
const btnReplay = document.getElementById('btn-replay');
const btnInspect = document.getElementById('btn-inspect');
const btnShare = document.getElementById('btn-share');
const btnBackPoster = document.getElementById('btn-back-poster');
const toastEl = document.getElementById('toast');

/* ==========================================================================
   Vampiric Carti Chant Audio Engine + Spin Riser & Drop Impact
   ========================================================================== */

class GothicAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.userMuted = false;
    this.masterGain = null;
    this.riserOsc = null;
    this.riserGain = null;

    this.bgm = new Audio('assets/svinchik-vamp-chant.mp3');
    this.bgm.loop = true;
    this.bgm.preload = 'auto';
    this.bgm.volume = 0.85;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.0;
    this.masterGain.connect(this.ctx.destination);

    // Spin riser synth layered subtly over the vamp organ intro
    this.riserOsc = this.ctx.createOscillator();
    this.riserOsc.type = 'sawtooth';
    this.riserOsc.frequency.value = 55;
    const riserFilter = this.ctx.createBiquadFilter();
    riserFilter.type = 'bandpass';
    riserFilter.frequency.value = 340;
    riserFilter.Q.value = 2.6;
    this.riserGain = this.ctx.createGain();
    this.riserGain.gain.value = 0.0;

    this.riserOsc.connect(riserFilter);
    riserFilter.connect(this.riserGain);
    this.riserGain.connect(this.masterGain);
    this.riserOsc.start();
  }

  async enable(resetTrack = false) {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Ignore resume errors before user gesture
      }
    }
    if (resetTrack) {
      this.bgm.currentTime = 0;
    }
    try {
      await this.bgm.play();
      this.enabled = true;
      this.userMuted = false;
      if (this.ctx && this.masterGain) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(0.32, now, 0.12);
      }
      return true;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  disable() {
    this.enabled = false;
    this.userMuted = true;
    this.bgm.pause();
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0.0, now, 0.1);
    }
  }

  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    }
    return await this.enable(false);
  }

  syncToRitualStart() {
    if (!this.enabled) return;
    this.bgm.currentTime = 0;
    this.bgm.play().catch(() => {});
  }

  updateSpin(progress) {
    if (!this.ctx || !this.enabled || !this.riserOsc) return;
    const now = this.ctx.currentTime;
    const freq = 55 + Math.pow(progress, 2.2) * 320;
    const gain = Math.min(0.22, progress * 0.22);
    this.riserOsc.frequency.setTargetAtTime(freq, now, 0.06);
    this.riserGain.gain.setTargetAtTime(gain, now, 0.06);
  }

  stopRiser() {
    if (!this.ctx || !this.riserGain) return;
    this.riserGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  playImpact() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;

    // Deep sub-bass drop layered on transformation
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.85);
    gain.gain.setValueAtTime(0.75, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.1);
  }
}

const audio = new GothicAudio();

/* ==========================================================================
   2D FX Canvas (Floating Embers + Transformation Shockwave Explosion)
   ========================================================================== */

let fxWidth = window.innerWidth;
let fxHeight = window.innerHeight;
const embers = [];
const explosionShards = [];
const shockwaves = [];

function resizeFxCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxWidth = window.innerWidth;
  fxHeight = window.innerHeight;
  fxCanvas.width = Math.floor(fxWidth * dpr);
  fxCanvas.height = Math.floor(fxHeight * dpr);
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function initEmbers() {
  embers.length = 0;
  const count = fxWidth < 640 ? 32 : 58;
  for (let i = 0; i < count; i++) {
    embers.push({
      x: Math.random() * fxWidth,
      y: Math.random() * fxHeight,
      r: 0.8 + Math.random() * 2.2,
      vy: -(0.22 + Math.random() * 0.65),
      vx: (Math.random() - 0.5) * 0.35,
      alpha: 0.2 + Math.random() * 0.65,
      crimson: Math.random() > 0.25,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

function triggerExplosionFX() {
  const cx = fxWidth * 0.5;
  const cy = fxHeight * 0.5;

  shockwaves.push(
    { x: cx, y: cy, r: 14, maxR: Math.max(fxWidth, fxHeight) * 0.85, alpha: 0.95, width: 4, color: '#ff1e3c' },
    { x: cx, y: cy, r: 8, maxR: Math.max(fxWidth, fxHeight) * 0.62, alpha: 0.8, width: 2, color: '#f4e8ec' }
  );

  const count = fxWidth < 640 ? 75 : 130;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3.5 + Math.random() * 16;
    explosionShards.push({
      x: cx + (Math.random() - 0.5) * 24,
      y: cy + (Math.random() - 0.5) * 24,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1.5 + Math.random() * 4.5,
      alpha: 1,
      decay: 0.012 + Math.random() * 0.022,
      crimson: Math.random() > 0.2,
    });
  }
}

function renderFxCanvas(time, spinIntensity) {
  fxCtx.clearRect(0, 0, fxWidth, fxHeight);

  // Ambient crimson & silver embers
  for (let i = 0; i < embers.length; i++) {
    const e = embers[i];
    const boost = 1 + spinIntensity * 4.5;
    e.y += e.vy * boost;
    e.x += e.vx + Math.sin(time * 0.0012 + e.phase) * 0.28;

    if (e.y < -12) {
      e.y = fxHeight + 12;
      e.x = Math.random() * fxWidth;
    }
    if (e.x < -12) e.x = fxWidth + 12;
    if (e.x > fxWidth + 12) e.x = -12;

    fxCtx.beginPath();
    fxCtx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    fxCtx.fillStyle = e.crimson
      ? `rgba(232, 10, 40, ${e.alpha})`
      : `rgba(230, 224, 236, ${e.alpha * 0.65})`;
    fxCtx.fill();
  }

  // Shockwaves
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    sw.r += (sw.maxR - sw.r) * 0.095;
    sw.alpha *= 0.91;
    sw.width *= 0.96;

    fxCtx.save();
    fxCtx.beginPath();
    fxCtx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
    fxCtx.strokeStyle = sw.color;
    fxCtx.globalAlpha = Math.max(0, sw.alpha);
    fxCtx.lineWidth = Math.max(0.5, sw.width);
    fxCtx.stroke();
    fxCtx.restore();

    if (sw.alpha < 0.02) shockwaves.splice(i, 1);
  }

  // Explosion shards
  for (let i = explosionShards.length - 1; i >= 0; i--) {
    const s = explosionShards[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.96;
    s.vy *= 0.96;
    s.vy += 0.05;
    s.alpha -= s.decay;

    if (s.alpha <= 0) {
      explosionShards.splice(i, 1);
      continue;
    }

    fxCtx.save();
    fxCtx.globalAlpha = s.alpha;
    fxCtx.fillStyle = s.crimson ? '#ff1e3c' : '#f2edf6';
    fxCtx.beginPath();
    fxCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    fxCtx.fill();
    fxCtx.restore();
  }
}

resizeFxCanvas();
initEmbers();

/* ==========================================================================
   Three.js Gothic 3D Scene Setup
   ========================================================================== */

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
const BASE_CAM_Z = 5.4;
camera.position.set(0, 0.25, BASE_CAM_Z);

const renderer = new THREE.WebGLRenderer({
  canvas: webglCanvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 2.6;
controls.maxDistance = 8.5;
controls.enabled = false;

// Dramatic Vampiric 4-Point Lighting
const ambientLight = new THREE.AmbientLight(0x281a24, 1.35);
scene.add(ambientLight);

const frontKeyLight = new THREE.DirectionalLight(0xf6e8ea, 1.85);
frontKeyLight.position.set(1.5, 2.8, 4.5);
scene.add(frontKeyLight);

const crimsonRimLight = new THREE.PointLight(0xe80a28, 18, 14, 1.6);
crimsonRimLight.position.set(-2.8, 1.4, -1.6);
scene.add(crimsonRimLight);

const moonlightRim = new THREE.PointLight(0xb8c8ff, 11, 14, 1.6);
moonlightRim.position.set(3.0, 2.2, -1.8);
scene.add(moonlightRim);

const underCrimsonLight = new THREE.PointLight(0xd90429, 8, 10, 1.5);
underCrimsonLight.position.set(0, -2.3, 1.0);
scene.add(underCrimsonLight);

// Procedural Gothic Ritual Circle on Floor
function createGothicSigilTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Outer crimson glow ring
  ctx.strokeStyle = 'rgba(232, 10, 40, 0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 232, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(232, 10, 40, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 206, 0, Math.PI * 2);
  ctx.stroke();

  // Inner dashed ring
  ctx.save();
  ctx.setLineDash([12, 10]);
  ctx.strokeStyle = 'rgba(230, 224, 236, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 168, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Gothic 8-pointed star / sigil geometry
  ctx.strokeStyle = 'rgba(232, 10, 40, 0.65)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 8; i++) {
    const a1 = (i * Math.PI) / 4;
    const a2 = ((i + 3) * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a1) * 204, cy + Math.sin(a1) * 204);
    ctx.lineTo(cx + Math.cos(a2) * 204, cy + Math.sin(a2) * 204);
    ctx.stroke();
  }

  // Tiny crosses around perimeter
  ctx.fillStyle = 'rgba(244, 236, 240, 0.8)';
  ctx.font = 'bold 22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    ctx.fillText('†', cx + Math.cos(a) * 219, cy + Math.sin(a) * 219);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const sigilMaterial = new THREE.MeshBasicMaterial({
  map: createGothicSigilTexture(),
  transparent: true,
  opacity: 0.72,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const sigilPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), sigilMaterial);
sigilPlane.rotation.x = -Math.PI / 2;
sigilPlane.position.y = -1.65;
scene.add(sigilPlane);

// 3D Orbiting Vortex Embers
const VORTEX_COUNT = 260;
const vortexPositions = new Float32Array(VORTEX_COUNT * 3);
const vortexMeta = [];

for (let i = 0; i < VORTEX_COUNT; i++) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 1.45 + Math.random() * 2.4;
  const y = (Math.random() - 0.5) * 3.4;
  vortexMeta.push({ angle, radius, baseRadius: radius, y, speed: 0.5 + Math.random() * 1.4 });
  vortexPositions[i * 3] = Math.cos(angle) * radius;
  vortexPositions[i * 3 + 1] = y;
  vortexPositions[i * 3 + 2] = Math.sin(angle) * radius;
}

const vortexGeo = new THREE.BufferGeometry();
vortexGeo.setAttribute('position', new THREE.BufferAttribute(vortexPositions, 3));
const vortexMat = new THREE.PointsMaterial({
  color: 0xff1e3c,
  size: 0.055,
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const vortexPoints = new THREE.Points(vortexGeo, vortexMat);
scene.add(vortexPoints);

// Piggy Container
const pigRoot = new THREE.Group();
scene.add(pigRoot);
let pigLoaded = false;

/* ==========================================================================
   Load pig.glb with Progress & Auto-Normalization
   ========================================================================== */

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
loader.setDRACOLoader(dracoLoader);

let displayedProgress = 0;
let targetProgress = 8;

function updateLoaderUI() {
  displayedProgress += (targetProgress - displayedProgress) * 0.14;
  const pct = Math.min(100, Math.round(displayedProgress));
  loaderBar.style.width = `${pct}%`;
  loaderPercent.textContent = `${pct}%`;
  if (appState === 'loading') {
    requestAnimationFrame(updateLoaderUI);
  }
}

/* ==========================================================================
   State Machine & Ritual Choreography
   States: 'loading' | 'spinning' | 'transforming' | 'poster' | 'inspect'
   ========================================================================== */

let appState = 'loading';
let spinElapsed = 0;
const SPIN_DURATION = 6.15; // Synced to 4-bar 148 BPM vamp organ intro -> 808 drop hits on poster reveal!
let isBoosting = false;
let currentOmega = 0.7;
let transformElapsed = 0;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setAppState(nextState) {
  appState = nextState;
  body.classList.remove('state-loading', 'state-spinning', 'state-transforming', 'state-poster', 'state-inspect');
  body.classList.add(`state-${nextState}`);

  ritualHud.setAttribute('aria-hidden', nextState !== 'spinning' ? 'true' : 'false');
  posterStage.setAttribute('aria-hidden', nextState !== 'poster' ? 'true' : 'false');
  inspectHud.setAttribute('aria-hidden', nextState !== 'inspect' ? 'true' : 'false');
  controls.enabled = nextState === 'inspect';
}

function startRitual() {
  if (prefersReducedMotion) {
    revealPosterImmediately();
    return;
  }

  spinElapsed = 0;
  transformElapsed = 0;
  currentOmega = 0.7;
  isBoosting = false;

  pigRoot.visible = true;
  pigRoot.scale.set(1, 1, 1);
  pigRoot.position.set(0, -0.35, 0);
  pigRoot.rotation.set(0, 0, 0);

  sigilPlane.visible = true;
  sigilMaterial.opacity = 0.72;
  vortexPoints.visible = true;

  camera.position.set(0, 0.25, BASE_CAM_Z);
  camera.lookAt(0, 0, 0);

  eclipseFlash.classList.remove('active');
  setAppState('spinning');

  if (audio.enabled) {
    audio.syncToRitualStart();
  } else if (!audio.userMuted) {
    audio.enable(true).then((ok) => {
      if (ok) btnSound.setAttribute('aria-pressed', 'true');
    });
  }
}

function triggerTransformation() {
  setAppState('transforming');
  transformElapsed = 0;

  audio.stopRiser();
  audio.playImpact();

  // Trigger visual eclipse flash & 2D shockwave explosion
  eclipseFlash.classList.remove('active');
  void eclipseFlash.offsetWidth;
  eclipseFlash.classList.add('active');
  triggerExplosionFX();

  // Transition to Poster Reveal right at the peak of the crimson flash
  window.setTimeout(() => {
    if (appState === 'transforming') {
      pigRoot.visible = false;
      setAppState('poster');
    }
  }, 340);
}

function revealPosterImmediately() {
  audio.stopRiser();
  pigRoot.visible = false;
  setAppState('poster');
}

function enterInspectMode() {
  pigRoot.visible = true;
  pigRoot.scale.set(1, 1, 1);
  pigRoot.position.set(0, 0, 0);
  pigRoot.rotation.set(0, 0, 0);

  sigilPlane.visible = true;
  sigilMaterial.opacity = 0.55;
  vortexPoints.visible = true;

  camera.position.set(0, 0.2, 4.9);
  controls.target.set(0, 0, 0);
  controls.update();

  setAppState('inspect');
}

requestAnimationFrame(updateLoaderUI);

loader.load(
  'assets/pig.glb',
  (gltf) => {
    const model = gltf.scene;

    // Normalize bounding box so piggy sits dead-center at ~2.7 units tall
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.75 / maxDim;

    model.scale.setScalar(scale);
    model.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale
    );

    // Subtle material polish for gothic lighting
    model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.castShadow = false;
        child.receiveShadow = false;
        if ('envMapIntensity' in child.material) {
          child.material.envMapIntensity = 1.1;
        }
      }
    });

    pigRoot.add(model);
    pigLoaded = true;
    targetProgress = 100;
    loaderStatus.textContent = 'ГОТОВО';

    window.setTimeout(() => {
      startRitual();
    }, 360);
  },
  (xhr) => {
    if (xhr.lengthComputable && xhr.total > 0) {
      targetProgress = Math.max(10, Math.min(98, (xhr.loaded / xhr.total) * 100));
    } else {
      targetProgress = Math.min(92, targetProgress + 4);
    }
  },
  (err) => {
    console.error('Failed to load pig.glb:', err);
    loaderStatus.textContent = 'ПЕРЕХОД К ПОСТЕРУ';
    targetProgress = 100;
    window.setTimeout(() => {
      revealPosterImmediately();
    }, 450);
  }
);

/* ==========================================================================
   Main Animation Loop
   ========================================================================== */

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsedTime();
  let spinIntensity = 0;

  if (appState === 'spinning' && pigLoaded) {
    const rate = isBoosting ? 2.15 : 1.0;
    spinElapsed += dt * rate;
    const progress = Math.min(1, spinElapsed / SPIN_DURATION);
    spinIntensity = progress;

    // Smooth rise from mist in the first 1.1s
    const riseT = Math.min(1, spinElapsed / 1.1);
    const easedRise = 1 - Math.pow(1 - riseT, 3);
    const hoverY = Math.sin(elapsed * 2.6) * 0.06;
    pigRoot.position.y = -0.45 * (1 - easedRise) + hoverY + Math.pow(progress, 3) * 0.25;

    // Exponential spin-up: slow ominous turn -> hyper-spin!
    // Starts around 0.7 rad/s and accelerates up to ~48 rad/s
    currentOmega = 0.7 + Math.pow(progress, 3.1) * 47.0;
    pigRoot.rotation.y += currentOmega * dt;

    // Subtle gothic tilt oscillation as speed builds
    pigRoot.rotation.z = Math.sin(elapsed * 6.5) * 0.045 * progress;

    // Camera dolly-in + micro tremor near climax
    const camZ = BASE_CAM_Z - Math.pow(progress, 2) * 1.15;
    const shakeAmp = Math.pow(Math.max(0, progress - 0.55) / 0.45, 2) * 0.065;
    camera.position.set(
      (Math.random() - 0.5) * shakeAmp,
      0.25 + (Math.random() - 0.5) * shakeAmp,
      camZ
    );
    camera.lookAt(0, pigRoot.position.y * 0.35, 0);

    // Intensify crimson lights as RPM peaks
    crimsonRimLight.intensity = 18 + Math.pow(progress, 2) * 34;
    underCrimsonLight.intensity = 8 + Math.pow(progress, 2) * 24;

    // Counter-rotate gothic sigil faster
    sigilPlane.rotation.z -= (0.4 + Math.pow(progress, 2.5) * 8.5) * dt;
    sigilMaterial.opacity = 0.65 + progress * 0.35;

    // Update HUD & audio riser
    const rpm = Math.round((currentOmega * 60) / (Math.PI * 2));
    rpmReadout.textContent = `${String(rpm).padStart(3, '0')} RPM`;
    ritualMeterFill.style.width = `${(progress * 100).toFixed(1)}%`;
    audio.updateSpin(progress);

    if (progress >= 1) {
      triggerTransformation();
    }
  } else if (appState === 'transforming') {
    transformElapsed += dt;
    spinIntensity = 1;
    pigRoot.rotation.y += 58 * dt;
    const stretch = 1 + transformElapsed * 3.5;
    pigRoot.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
  } else if (appState === 'inspect') {
    controls.update();
    sigilPlane.rotation.z -= 0.22 * dt;
    crimsonRimLight.intensity = 20 + Math.sin(elapsed * 2) * 3;
    underCrimsonLight.intensity = 9;
  }

  // Update 3D vortex particles
  if (vortexPoints.visible) {
    const pos = vortexGeo.attributes.position.array;
    const vortexMult = 1 + spinIntensity * 7.5;
    for (let i = 0; i < VORTEX_COUNT; i++) {
      const m = vortexMeta[i];
      m.angle += m.speed * vortexMult * dt;
      const pull = 1 - spinIntensity * 0.42;
      const r = m.baseRadius * pull;
      pos[i * 3] = Math.cos(m.angle) * r;
      pos[i * 3 + 1] = m.y + Math.sin(elapsed * 1.4 + i) * 0.08;
      pos[i * 3 + 2] = Math.sin(m.angle) * r;
    }
    vortexGeo.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, camera);
  renderFxCanvas(performance.now(), spinIntensity);
}

animate();

/* ==========================================================================
   Interactions & UI Controls
   ========================================================================== */

// Hold anywhere on canvas during spin-up to boost speed
function setBoost(active) {
  if (appState !== 'spinning') {
    isBoosting = false;
    return;
  }
  isBoosting = active;
  ritualHint.textContent = active
    ? 'УСКОРЕНИЕ ОБРЯДА...'
    : 'Удерживай экран, чтобы ускорить вращение';
}

webglCanvas.addEventListener('pointerdown', () => setBoost(true));
window.addEventListener('pointerup', () => setBoost(false));
window.addEventListener('pointercancel', () => setBoost(false));

// Sound toggle
btnSound.addEventListener('click', async (e) => {
  e.stopPropagation();
  const isOn = await audio.toggle();
  btnSound.setAttribute('aria-pressed', isOn ? 'true' : 'false');
});

// Auto-unlock vampiric chant on first user tap/click anywhere (browser autoplay policy)
function tryAutoUnlockAudio(e) {
  if (e.target && e.target.closest('#btn-sound')) return;
  if (audio.enabled || audio.userMuted) return;
  audio.enable(appState === 'spinning' && spinElapsed < 1.2).then((ok) => {
    if (ok) {
      btnSound.setAttribute('aria-pressed', 'true');
    }
  });
}
window.addEventListener('pointerdown', tryAutoUnlockAudio, { passive: true });
window.addEventListener('keydown', tryAutoUnlockAudio, { passive: true });

// Skip intro
btnSkip.addEventListener('click', () => {
  revealPosterImmediately();
});

// Replay ritual
btnReplay.addEventListener('click', () => {
  if (!pigLoaded) return;
  startRitual();
});

// Inspect 3D model
btnInspect.addEventListener('click', () => {
  if (!pigLoaded) return;
  enterInspectMode();
});

btnBackPoster.addEventListener('click', () => {
  revealPosterImmediately();
});

// Share / Copy link
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 2600);
}

btnShare.addEventListener('click', async () => {
  const url = window.location.href;
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'svinchik.mp3 — SOON',
        text: 'svinchik.mp3 — скоро на всех площадках',
        url,
      });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast('Ссылка скопирована');
  } catch {
    showToast('Скопируй ссылку из адресной строки');
  }
});

// 3D Parallax Tilt & Metallic Sheen on Poster Card
if (!prefersReducedMotion) {
  posterCard.addEventListener('pointermove', (e) => {
    if (appState !== 'poster') return;
    const rect = posterCard.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const rotY = (nx - 0.5) * 14;
    const rotX = (0.5 - ny) * 12;

    posterCard.classList.add('interactive-tilt');
    posterCard.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale(1.015)`;
    posterCard.style.setProperty('--mx', `${(nx * 100).toFixed(1)}%`);
    posterCard.style.setProperty('--my', `${(ny * 100).toFixed(1)}%`);
  });

  posterCard.addEventListener('pointerleave', () => {
    posterCard.classList.remove('interactive-tilt');
    posterCard.style.transform = '';
  });
}

// Responsive Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  resizeFxCanvas();
  initEmbers();
});
