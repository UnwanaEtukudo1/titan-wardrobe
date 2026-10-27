import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------------------------------------------------------------- wardrobe data
// Pieces match the `wardrobe_piece` tags on the meshes in minotaur.glb. Pieces in the same
// slot replace each other; `fit` names the body morph that tucks the skin under that piece.
const PIECES = {
  cap:       { label: 'Cap' },
  chain:     { label: 'Chain' },
  jacket:    { label: 'Jacket',     slot: 'top',    fit: 'fitp_jacket' },
  shorts:    { label: 'Shorts',     slot: 'bottom', fit: 'fitp_shorts' },
  sneakers:  { label: 'Sneakers',                   fit: 'fitp_sneakers' },
  watch:     { label: 'Watch' },
  tee:       { label: 'Tee',        slot: 'top',    fit: 'fitp_tee' },
  teeshorts: { label: 'Tee Shorts', slot: 'bottom', fit: 'fitp_teeshorts' },
  slacks:    { label: 'Slacks',     slot: 'bottom', fit: 'fitp_slacks' },
};
const PRESETS = {
  everything: { label: 'Everything', pieces: ['cap', 'chain', 'jacket', 'shorts', 'sneakers', 'watch'] },
  base:       { label: 'Base only',  pieces: [] },
};
const MOTIONS = { idle: { label: 'Pose', clip: 'Idle' }, run: { label: 'Running', clip: 'Running' }, walk: { label: 'Walking', clip: 'Walking' } };
const MODEL_URL = 'minotaur.glb';
const DRAG_SPEED = 0.011;        // radians per pixel
const TURNTABLE_SPEED = 0.6;     // radians per second
const FADE = 0.35;               // seconds to blend between motions

const state = { worn: new Set(PRESETS.everything.pieces), motion: 'idle', paused: false, turntable: false };

// ---------------------------------------------------------------- renderer & stage
const stage = document.getElementById('stage');
const canvas = document.getElementById('view');
const loading = document.getElementById('loading');
const bar = document.getElementById('loading-bar');
const loadText = document.getElementById('loading-text');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (err) {
  fail('This browser could not start 3D graphics (WebGL). Try another browser or turn off battery saver.');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const BG = new THREE.Color('#0d1524');
const scene = new THREE.Scene();
scene.background = BG;
scene.fog = new THREE.Fog(BG, 7, 17);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight('#c3d0f0', '#0a0f1c', 0.7));
const key = new THREE.DirectionalLight('#fff3e6', 2.4); key.position.set(1.8, 3.5, 3.2); scene.add(key);
const rimL = new THREE.DirectionalLight('#c8d4ff', 1.8); rimL.position.set(-3, 2.4, -2.6); scene.add(rimL);
const rimR = new THREE.DirectionalLight('#dfe4f2', 1.3); rimR.position.set(3, 2.2, -2.2); scene.add(rimR);

// floor, platform and the thin ring
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: '#1a2233', roughness: 0.95, metalness: 0 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.14; scene.add(floor);
const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.76, 0.14, 96),
  new THREE.MeshStandardMaterial({ color: '#0a111e', roughness: 0.7, metalness: 0.1, envMapIntensity: 0.4 }));
platform.position.y = -0.07; scene.add(platform);
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.80, 0.0055, 8, 192),
  new THREE.MeshBasicMaterial({ color: '#8e8c84' }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);
scene.add(contactShadow());

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
const pivot = new THREE.Group(); scene.add(pivot);   // the character turns inside this

function frameCamera() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the whole figure plus platform in view, with room above for the title.
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const portrait = h > w;
  const halfH = portrait ? 1.2 : 1.18;     // metres of scene above/below the aim point
  const halfW = 0.92;
  const dist = Math.max(halfH / t, halfW / (t * camera.aspect));
  const aimY = portrait ? 1.0 : 0.98;
  camera.position.set(0, aimY + dist * 0.05, dist);
  camera.lookAt(0, aimY, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(frameCamera).observe(stage);
frameCamera();

// ---------------------------------------------------------------- model
let mixer = null, body = null;
const actions = {};
const pieceNodes = {};
let current = null;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loadModelBytes(showProgress).then((bytes) => loader.parse(bytes, '', onModel, onModelError), onModelError);

function onModel(gltf) {
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
    const piece = o.userData && o.userData.wardrobe_piece;
    if (piece) (pieceNodes[piece] ||= []).push(o);
    if (o.isMesh && o.morphTargetDictionary && 'fitp_jacket' in o.morphTargetDictionary) body = o;
  });
  pivot.add(root);
  mixer = new THREE.AnimationMixer(root);
  for (const [key, m] of Object.entries(MOTIONS)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, m.clip);
    if (clip) actions[key] = mixer.clipAction(clip);
  }
  applyPieces();
  playMotion(state.motion, true);
  loading.hidden = true;
}

function onModelError(err) {
  console.error(err);
  fail('The 3D model could not load. Check your connection and reload the page.');
}

function showProgress(fraction) {
  const pct = Math.round(fraction * 100);
  bar.style.width = pct + '%';
  loadText.textContent = `Loading the Titan… ${pct}%`;
}

// Downloads minotaur.glb with progress. (The claude.ai test build swaps this function for one
// that reads the same bytes from a script file, since that host doesn't serve .glb files.)
async function loadModelBytes(onProgress) {
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${MODEL_URL}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got); got += value.length;
    onProgress(got / total);
  }
  return out.buffer;
}

function applyPieces() {
  for (const [key, nodes] of Object.entries(pieceNodes)) {
    for (const n of nodes) n.visible = state.worn.has(key);
  }
  if (body) {
    const dict = body.morphTargetDictionary, inf = body.morphTargetInfluences;
    for (const [name, i] of Object.entries(dict)) inf[i] = 0;
    for (const key of state.worn) {
      const fit = PIECES[key].fit;
      if (fit && fit in dict) inf[dict[fit]] = 1;
    }
  }
}

function playMotion(key, instant = false) {
  const next = actions[key];
  if (!next || next === current) return;
  next.enabled = true;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  next.time = 0;
  next.play();
  if (current && !instant) current.crossFadeTo(next, FADE, true);
  else if (current) current.stop();
  current = next;
}

// ---------------------------------------------------------------- controls
const outfitRow = document.getElementById('outfit-pills');
const motionRow = document.getElementById('motion-pills');
const buttons = {};

function pill(parent, id, label, onTap) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pill'; b.id = id; b.textContent = label;
  b.addEventListener('click', onTap);
  parent.appendChild(b);
  buttons[id] = b;
  return b;
}

for (const [key, p] of Object.entries(PRESETS)) {
  pill(outfitRow, 'preset-' + key, p.label, () => { state.worn = new Set(p.pieces); update(); });
}
for (const [key, p] of Object.entries(PIECES)) {
  pill(outfitRow, 'piece-' + key, p.label, () => {
    if (state.worn.has(key)) state.worn.delete(key);
    else {
      if (p.slot) for (const k of [...state.worn]) if (PIECES[k].slot === p.slot) state.worn.delete(k);
      state.worn.add(key);
    }
    update();
  });
}
for (const [key, m] of Object.entries(MOTIONS)) {
  pill(motionRow, 'motion-' + key, m.label, () => { state.motion = key; playMotion(key); update(); });
}
const transport = document.getElementById('transport-pills');
pill(transport, 'play', 'Pause', () => { state.paused = !state.paused; update(); });
pill(transport, 'turntable', 'Turntable', () => { state.turntable = !state.turntable; update(); });
pill(transport, 'reset-view', 'Reset view', () => { state.turntable = false; resetting = true; update(); });

function update() {
  for (const key of Object.keys(PIECES)) setOn('piece-' + key, state.worn.has(key));
  for (const key of Object.keys(PRESETS)) setOn('preset-' + key, false);
  for (const key of Object.keys(MOTIONS)) setOn('motion-' + key, state.motion === key);
  buttons.play.textContent = state.paused ? 'Play' : 'Pause';
  setOn('turntable', state.turntable);
  applyPieces();
}
function setOn(id, on) {
  buttons[id].classList.toggle('on', on);
  buttons[id].setAttribute('aria-pressed', on ? 'true' : 'false');
}
update();

// drag to turn
let dragX = null, resetting = false;
canvas.addEventListener('pointerdown', (e) => {
  dragX = e.clientX; resetting = false;
  canvas.setPointerCapture(e.pointerId);
  stage.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (dragX === null) return;
  pivot.rotation.y += (e.clientX - dragX) * DRAG_SPEED;
  dragX = e.clientX;
});
const endDrag = () => { dragX = null; stage.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mixer && !state.paused) mixer.update(dt);
  if (state.turntable && dragX === null) pivot.rotation.y += TURNTABLE_SPEED * dt;
  if (resetting) {
    let a = THREE.MathUtils.euclideanModulo(pivot.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    a *= Math.pow(0.0005, dt);           // ease back to facing front
    pivot.rotation.y = a;
    if (Math.abs(a) < 0.002) { pivot.rotation.y = 0; resetting = false; }
  }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- helpers
function contactShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.003;
  return m;
}

function fail(msg) {
  loading.hidden = false;
  loading.classList.add('error');
  loadText.textContent = msg;
}
