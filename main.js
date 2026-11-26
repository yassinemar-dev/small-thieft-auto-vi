import * as THREE from 'three';
import { Game } from './game.js';
import { GameAudio } from './audio.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

const canvas = document.getElementById('game-canvas');

// ---- Scene: Vice City sunset ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xff7a9c);
scene.fog = new THREE.FogExp2(0xe99087, 0.00042);

// Gradient sky dome — vertex colours are repainted by the day-night clock
const skyGeo = new THREE.SphereGeometry(3500, 32, 20);
const skyPos = skyGeo.attributes.position;
const skyY = new Float32Array(skyPos.count);
const skyColorAttr = new THREE.Float32BufferAttribute(new Float32Array(skyPos.count * 3), 3);
skyGeo.setAttribute('color', skyColorAttr);
for (let i = 0; i < skyPos.count; i++) skyY[i] = skyPos.getY(i) / 3500;
function paintSky(topC, midC, lowC) {
  const arr = skyColorAttr.array;
  const c = new THREE.Color();
  for (let i = 0; i < skyY.length; i++) {
    const y = skyY[i];
    if (y > 0.25) c.copy(midC).lerp(topC, Math.min(1, (y - 0.25) / 0.75));
    else c.copy(lowC).lerp(midC, Math.max(0, (y + 0.25) / 0.5));
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  skyColorAttr.needsUpdate = true;
}
paintSky(new THREE.Color(0x101a44), new THREE.Color(0x8a4a8f), new THREE.Color(0xff9a7a));
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
}));
scene.add(sky);

// ---- Drifting sunset clouds (children of the sky dome, so they follow camera) ----
function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = 60 + Math.random() * 136;
    const y = 90 + Math.random() * 76;
    const r = 34 + Math.random() * 48;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,246,238,0.55)');
    g.addColorStop(0.55, 'rgba(255,214,206,0.24)');
    g.addColorStop(1, 'rgba(255,180,180,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const cloudTex = cloudTexture();
const cloudGroup = new THREE.Group();
sky.add(cloudGroup);
for (let i = 0; i < 14; i++) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.38 + Math.random() * 0.18,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    color: i % 3 === 0 ? 0xffd8cc : 0xfff4ea
  }));
  const a = Math.random() * Math.PI * 2;
  const r = 1300 + Math.random() * 1500;
  sprite.position.set(Math.cos(a) * r, 480 + Math.random() * 620, Math.sin(a) * r);
  sprite.scale.set(620 + Math.random() * 520, 190 + Math.random() * 130, 1);
  cloudGroup.add(sprite);
}
cloudGroup.children.forEach(s => {
  s.userData.baseOpacity = s.material.opacity;
  s.userData.baseColor = s.material.color.clone();
});

// ---- Sun + lens flare ----
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(70, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xffe6b8, fog: false, toneMapped: false })
);
scene.add(sun);

function flareTexture(kind) {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  if (kind === 'glow') {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,244,214,0.95)');
    g.addColorStop(0.4, 'rgba(255,170,110,0.32)');
    g.addColorStop(1, 'rgba(255,120,80,0)');
    c.fillStyle = g; c.fillRect(0, 0, size, size);
  } else if (kind === 'ring') {
    c.strokeStyle = 'rgba(255,220,190,0.85)';
    c.lineWidth = 5;
    c.beginPath(); c.arc(64, 64, 42, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,160,120,0.35)';
    c.lineWidth = 12;
    c.beginPath(); c.arc(64, 64, 42, 0, Math.PI * 2); c.stroke();
  } else { // streak / anamorphic bar
    const g = c.createLinearGradient(0, 0, size, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,235,210,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 54, size, 20);
    const v = c.createLinearGradient(0, 0, 0, size);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = v;
    c.fillRect(58, 0, 12, size);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const texGlow = flareTexture('glow');
const texRing = flareTexture('ring');
const texStreak = flareTexture('streak');

const lensflare = new Lensflare();
const flareElements = [
  new LensflareElement(texGlow, 320, 0, new THREE.Color(0xffd9a8)),
  new LensflareElement(texStreak, 250, 0.06, new THREE.Color(0xffa878)),
  new LensflareElement(texRing, 150, 0.42, new THREE.Color(0xff9ac0)),
  new LensflareElement(texGlow, 120, 0.62, new THREE.Color(0xffcf80))
];
flareElements.forEach(el => { lensflare.addElement(el); el.userData = { base: el.color.clone() }; });
sun.add(lensflare);

// ---- Lighting ----
const hemi = new THREE.HemisphereLight(0xffc2b8, 0x33405a, 0.7);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffd0b0, 2.5);
dirLight.position.set(-280, 160, -400);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 700;
dirLight.shadow.camera.left = -260;
dirLight.shadow.camera.right = 260;
dirLight.shadow.camera.top = 260;
dirLight.shadow.camera.bottom = -260;
dirLight.shadow.bias = -0.0001;
dirLight.shadow.normalBias = 0.8;
scene.add(dirLight, dirLight.target);

const fill = new THREE.DirectionalLight(0x7fb0ff, 0.3);
fill.position.set(200, 120, 300);
scene.add(fill);

// ---- Shared day-night clock: golden hour → dusk → blue hour → golden hour ----
const DAY_LENGTH = 360;
const GOLDEN = {
  top: 0x101a44, mid: 0x8a4a8f, low: 0xff9a7a, bg: 0xff7a9c, fog: 0xe99087,
  fogDensity: 0.00042, sun: 0xffe6b8, dir: 0xffd0b0, dirI: 2.5, sunY: 300,
  hemiSky: 0xffc2b8, hemiGround: 0x33405a, hemiI: 0.7, ambI: 0.2,
  fill: 0x7fb0ff, fillI: 0.3, exposure: 1.05, night: 0.22
};
const PALETTE = [
  { at: 0, ...GOLDEN },
  { at: 0.35,
    top: 0x0a1030, mid: 0x5d2a70, low: 0xff6f66, bg: 0xc85a80, fog: 0xa56178,
    fogDensity: 0.00050, sun: 0xffc090, dir: 0xffa078, dirI: 1.7, sunY: 150,
    hemiSky: 0xd88aa0, hemiGround: 0x24304a, hemiI: 0.6, ambI: 0.17,
    fill: 0x6a90ff, fillI: 0.42, exposure: 1.02, night: 0.62 },
  { at: 0.68,
    top: 0x05081c, mid: 0x1a1b46, low: 0x5c4278, bg: 0x2b2048, fog: 0x333a60,
    fogDensity: 0.00062, sun: 0xa8c0ff, dir: 0x8fa8ff, dirI: 0.7, sunY: 90,
    hemiSky: 0x8098d0, hemiGround: 0x1a2240, hemiI: 0.54, ambI: 0.18,
    fill: 0x5a80ff, fillI: 0.5, exposure: 1.16, night: 1 },
  { at: 1, ...GOLDEN }
];
const skyTop = new THREE.Color(), skyMid = new THREE.Color(), skyLow = new THREE.Color();
const fogCol = new THREE.Color(), bgCol = new THREE.Color(), sunCol = new THREE.Color();
const dirCol = new THREE.Color(), hemiSkyCol = new THREE.Color();
const hemiGroundCol = new THREE.Color(), fillCol = new THREE.Color(), tmpCol = new THREE.Color();

const dayNight = {
  t: 0,
  paintTimer: 0,
  night: 0,
  update(dt) {
    this.t = (this.t + dt / DAY_LENGTH) % 1;
    let i = 0;
    while (i < PALETTE.length - 2 && this.t > PALETTE[i + 1].at) i++;
    const a = PALETTE[i], b = PALETTE[i + 1];
    const k = THREE.MathUtils.smoothstep((this.t - a.at) / (b.at - a.at), 0, 1);
    const mix = (out, key) => out.setHex(a[key]).lerp(tmpCol.setHex(b[key]), k);

    mix(skyTop, 'top'); mix(skyMid, 'mid'); mix(skyLow, 'low');
    this.paintTimer += dt;
    if (this.paintTimer > 0.12) { paintSky(skyTop, skyMid, skyLow); this.paintTimer = 0; }

    mix(fogCol, 'fog'); scene.fog.color.copy(fogCol);
    scene.fog.density = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, k);
    mix(bgCol, 'bg'); scene.background.copy(bgCol);

    mix(sunCol, 'sun'); sun.material.color.copy(sunCol);
    flareElements.forEach(el => el.color.copy(el.userData.base).lerp(sunCol, 0.55));
    mix(dirCol, 'dir'); dirLight.color.copy(dirCol);
    dirLight.intensity = THREE.MathUtils.lerp(a.dirI, b.dirI, k);
    const sunY = THREE.MathUtils.lerp(a.sunY, b.sunY, k);
    sun.position.set(camera.position.x - 1200, sunY, camera.position.z - 1800);
    dirLight.position.set(-280, Math.max(60, sunY * 0.55), -400);

    mix(hemiSkyCol, 'hemiSky'); mix(hemiGroundCol, 'hemiGround');
    hemi.color.copy(hemiSkyCol); hemi.groundColor.copy(hemiGroundCol);
    hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, k);
    ambient.intensity = THREE.MathUtils.lerp(a.ambI, b.ambI, k);
    mix(fillCol, 'fill'); fill.color.copy(fillCol);
    fill.intensity = THREE.MathUtils.lerp(a.fillI, b.fillI, k);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(a.exposure, b.exposure, k);

    this.night = THREE.MathUtils.lerp(a.night, b.night, k);
    game?.city.setNightFactor(this.night);
    bloom.strength = THREE.MathUtils.lerp(0.55, 0.9, this.night);
    cloudGroup.children.forEach(s => {
      s.material.opacity = s.userData.baseOpacity * THREE.MathUtils.lerp(1, 0.55, this.night);
      s.material.color.copy(s.userData.baseColor).lerp(tmpCol.setHex(0x6a7ba8), this.night * 0.6);
    });

    const clock = document.getElementById('clock');
    if (clock) {
      const minutes = Math.floor(this.t * 360);
      clock.textContent = `${String(18 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }
  }
};

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 2, 5000);
camera.position.set(0, 60, 100);

// ---- Subtle film grade before tone mapping ----
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 0.22 },
    grain: { value: 0.012 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignette;
    uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = pow(max(c.rgb, 0.0), vec3(0.97)) * vec3(1.03, 0.995, 1.015);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - vignette * smoothstep(0.32, 0.82, d);
      c.rgb += (hash(vUv * 1024.0 + time) - 0.5) * grain;
      gl_FragColor = c;
    }
  `
};

// ---- Renderer + post-processing ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const composerTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  samples: 4
});
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const afterimage = new AfterimagePass(0.12);
composer.addPass(afterimage);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.82
);
composer.addPass(bloom);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.addPass(new OutputPass());

if (import.meta.env.DEV) {
  window.__renderer = renderer;
  window.__composer = composer;
  window.__bloom = bloom;
  window.__dayNight = dayNight;
  window.__setTime = (t) => { dayNight.t = t; dayNight.paintTimer = 1; dayNight.update(0); };
}

// ---- Game ----
const game = new Game(scene, camera);
const audio = new GameAudio();
game.audio = audio;
if (import.meta.env.DEV) {
  window.__game = game;
  window.__scene = scene;
  window.__camera = camera;
  window.__audio = audio;
}
window.addEventListener('pointerdown', () => audio.init(), { passive: true });
window.addEventListener('keydown', () => audio.init());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Pointer lock for mouse look ----
let pointerLocked = false;
canvas.addEventListener('click', () => canvas.requestPointerLock());

document.addEventListener('pointerlockchange', () => {
  pointerLocked = !!document.pointerLockElement;
  const hint = document.getElementById('hint');
  if (hint) hint.style.opacity = pointerLocked ? '0' : '';
});

// ---- Title screen handoff ----
const startScreen = document.getElementById('start-screen');
function beginPlay() {
  if (game.started) return;
  game.started = true;
  game.hintTimer = 12;
  audio.init();
  if (startScreen) startScreen.classList.add('hidden');
  try {
    const lock = canvas.requestPointerLock();
    if (lock && lock.catch) lock.catch(() => {});
  } catch (_) { /* keyboard start may not grant pointer lock */ }
}
document.getElementById('start-button')?.addEventListener('click', beginPlay);
window.addEventListener('keydown', (e) => {
  if (!game.started && (e.key === 'Enter' || e.key === ' ')) beginPlay();
});

const lookSensitivity = 0.0022;
let yaw = 0, pitch = 0.34;

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  yaw -= e.movementX * lookSensitivity;
  pitch -= e.movementY * lookSensitivity;
  pitch = Math.max(0.06, Math.min(1.1, pitch));
  game.setLook(yaw, pitch);
});

// ---- Loop ----
let lastTime = 0;
function gameLoop(timestamp) {
  const dt = Math.min(lastTime ? (timestamp - lastTime) / 1000 : 0, 0.05);
  lastTime = timestamp;

  if (game.started && !game.paused) {
    game.update(dt);
    game.draw();

    // Speed-sensitive motion blur + subtle FOV kick
    const speedRatio = Math.min(1, Math.abs(game.player.speed) / game.player.maxSpeed);
    afterimage.uniforms['damp'].value = game.player.inVehicle
      ? 0.12 + speedRatio * 0.42
      : 0.1 + Math.min(0.24, Math.abs(game.player.speed) / 54 * 0.24);
    const targetFov = 62 + (game.player.inVehicle ? speedRatio * 11 : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    grade.uniforms.time.value += dt;
    audio.update(game, dt);
  }

  sky.position.copy(camera.position);
  cloudGroup.rotation.y += dt * 0.004;
  dayNight.update(dt);
  composer.render();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
