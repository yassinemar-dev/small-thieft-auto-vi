import * as THREE from 'three';
import { Game } from './game.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

const canvas = document.getElementById('game-canvas');

// ---- Scene: Vice City sunset ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xff7a9c);
scene.fog = new THREE.FogExp2(0xd98aa0, 0.00055);

// Gradient sky dome
const skyGeo = new THREE.SphereGeometry(3500, 32, 20);
const skyColors = [];
const top = new THREE.Color(0x101a44);
const mid = new THREE.Color(0x8a4a8f);
const low = new THREE.Color(0xff9a7a);
const pos = skyGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const y = pos.getY(i) / 3500;
  const c = new THREE.Color();
  if (y > 0.15) c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.85));
  else c.copy(low).lerp(mid, Math.max(0, (y + 0.15) / 0.3));
  skyColors.push(c.r, c.g, c.b);
}
skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
}));
scene.add(sky);

// ---- Sun + lens flare ----
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(120, 24, 24),
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
lensflare.addElement(new LensflareElement(texGlow, 620, 0, new THREE.Color(0xffd9a8)));
lensflare.addElement(new LensflareElement(texStreak, 480, 0.06, new THREE.Color(0xffa878)));
lensflare.addElement(new LensflareElement(texGlow, 130, 0.24, new THREE.Color(0xfff0d8)));
lensflare.addElement(new LensflareElement(texRing, 280, 0.42, new THREE.Color(0xff9ac0)));
lensflare.addElement(new LensflareElement(texGlow, 200, 0.62, new THREE.Color(0xffcf80)));
lensflare.addElement(new LensflareElement(texStreak, 540, 0.86, new THREE.Color(0xff7048)));
sun.add(lensflare);

// ---- Lighting ----
scene.add(new THREE.HemisphereLight(0xffc0d0, 0x2a3a2a, 1.0));
scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const dirLight = new THREE.DirectionalLight(0xffd0b0, 2.1);
dirLight.position.set(-300, 260, -400);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 700;
dirLight.shadow.camera.left = -260;
dirLight.shadow.camera.right = 260;
dirLight.shadow.camera.top = 260;
dirLight.shadow.camera.bottom = -260;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight, dirLight.target);

const fill = new THREE.DirectionalLight(0x7fb0ff, 0.6);
fill.position.set(200, 120, 300);
scene.add(fill);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 60, 100);

// ---- Renderer + post-processing ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const afterimage = new AfterimagePass(0.55);
composer.addPass(afterimage);
composer.addPass(new OutputPass());

window.__renderer = renderer;
window.__composer = composer;

// ---- Game ----
const game = new Game(scene, camera);
window.__game = game;
window.__scene = scene;
window.__camera = camera;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
  const dt = lastTime ? (timestamp - lastTime) / 1000 : 0;
  lastTime = timestamp;

  game.update(dt);
  game.draw();

  sky.position.copy(camera.position);
  sun.position.set(camera.position.x - 1200, 300, camera.position.z - 1800);

  // Speed-sensitive motion blur + subtle FOV kick
  const speedRatio = Math.min(1, Math.abs(game.player.speed) / game.player.maxSpeed);
  afterimage.uniforms['damp'].value = game.player.inVehicle
    ? 0.5 + speedRatio * 0.36
    : 0.45 + Math.min(0.22, Math.abs(game.player.speed) / 54 * 0.22);
  const targetFov = 62 + (game.player.inVehicle ? speedRatio * 11 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  composer.render();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
