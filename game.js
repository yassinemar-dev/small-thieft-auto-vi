import * as THREE from 'three';
import { City } from './city.js';
import { Player } from './player.js';
import { createCar, createPedestrian, animatePedestrian } from './models.js';

const CAR_COLORS = [
  0xff2e63, 0x00d4ff, 0xffd23f, 0x9b5cff, 0x2eff9f,
  0xff7a3d, 0xf1f5f9, 0x1e40af, 0xdb2777, 0x65a30d
];

export class Game {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // Ground — procedural grass/dirt so the lots feel more San Andreas-like
    const groundCv = document.createElement('canvas');
    groundCv.width = groundCv.height = 256;
    const gc = groundCv.getContext('2d');
    gc.fillStyle = '#426136';
    gc.fillRect(0, 0, 256, 256);
    const patches = ['#4d703c', '#38562f', '#6a6a42', '#6b5a42'];
    for (let i = 0; i < 70; i++) {
      gc.fillStyle = patches[(Math.random() * patches.length) | 0];
      gc.globalAlpha = 0.18 + Math.random() * 0.22;
      gc.beginPath();
      gc.ellipse(Math.random() * 256, Math.random() * 256,
        12 + Math.random() * 38, 8 + Math.random() * 26,
        Math.random() * Math.PI, 0, Math.PI * 2);
      gc.fill();
    }
    gc.globalAlpha = 1;
    for (let i = 0; i < 2200; i++) {
      gc.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
      gc.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    const groundTex = new THREE.CanvasTexture(groundCv);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(30, 30);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 4;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Ocean strips (Vice City coastline)
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0e6f8e, metalness: 0.5, roughness: 0.25,
      transparent: true, opacity: 0.9
    });
    [-1, 1].forEach(s => {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 6000), oceanMat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(s * 2350, 0.1, 0);
      scene.add(water);
    });

    // City
    this.city = new City();
    this.city.build3D(scene);

    // Vehicles — always spawn on clear road lanes, never inside buildings
    this.vehicles = [];
    for (let i = 0; i < 18; i++) this.vehicles.push(this.createVehicle());
    // Park the starter car ahead of the player (-Z is forward). Spawning it
    // behind at +50 put the over-the-shoulder camera inside its cabin.
    const starter = this.createVehicle(0, -80);
    starter.userData.stationary = true; // wait at the spawn point for the player
    this.vehicles.push(starter);

    // Pedestrians
    this.pedestrians = [];
    for (let i = 0; i < 32; i++) this.pedestrians.push(this.createPedestrian());

    // Player
    this.player = new Player(scene);
    this.player.setGame(this);

    // Camera state
    this.yaw = 0;
    this.pitch = 0.34;
    this.camDistance = 34;     // on-foot: close over-the-shoulder
    this.camVehicleDistance = 62;
    this.camSide = 10;          // lateral offset so the player sits off-centre
    this.camOccluded = false;
    this.shake = 0;
    this.shakeOffset = new THREE.Vector3();

    // Game state
    this.wanted = 0;
    this.wantedTimer = 0;
    this.cash = 12450;
    this.keys = {};
    this.prevF = false;
    this.prevR = false;
    this.hintTimer = 12;

    window.addEventListener('keydown', (e) => { this.keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });

    this.initHUD();
  }

  createVehicle(x, z) {
    const color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
    const car = createCar(color);
    const spot = this.city.roadSpawn(x, z);
    car.position.set(spot.x, 15, spot.z);
    car.rotation.y = spot.dir + (Math.random() > 0.5 ? Math.PI : 0);
    car.userData.aiSpeed = 12 + Math.random() * 10;
    car.userData.aiTarget = car.rotation.y;
    this.scene.add(car);
    return car;
  }

  createPedestrian() {
    const mesh = createPedestrian();
    mesh.position.set((Math.random() - 0.5) * 1800, 0, (Math.random() - 0.5) * 1800);
    const ped = {
      mesh,
      vx: (Math.random() - 0.5) * 9,
      vz: (Math.random() - 0.5) * 9,
      alive: true,
      knocked: 0
    };
    this.scene.add(mesh);
    return ped;
  }

  setLook(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; }

  notify(text, cls = '') {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = text;
    el.className = 'show ' + cls;
    clearTimeout(this._notifyTimer);
    this._notifyTimer = setTimeout(() => { el.className = ''; }, 2200);
  }

  initHUD() {
    const stars = document.getElementById('wanted');
    if (stars) {
      stars.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const s = document.createElement('div');
        s.className = 'star off';
        stars.appendChild(s);
      }
    }
  }

  addWanted(n) {
    this.wanted = Math.min(5, this.wanted + n);
    this.wantedTimer = 16;
    this.notify('WANTED LEVEL ' + this.wanted, 'pink');
  }

  update(dt) {
    dt = Math.min(dt, 0.05);

    // ---- Input: F enter/exit, R repair ----
    const f = !!this.keys['f'];
    if (f && !this.prevF) {
      if (this.player.inVehicle) {
        this.player.exitVehicle();
        this.notify('ON FOOT', 'green');
      } else if (this.player.tryEnterVehicle(this.vehicles)) {
        this.notify('VEHICLE ENTERED', 'green');
      }
    }
    this.prevF = f;

    const r = !!this.keys['r'];
    if (r && !this.prevR) {
      this.player.repair();
      this.notify('REPAIRED', 'green');
    }
    this.prevR = r;

    // ---- Player + collision ----
    this.player.update(dt, this.yaw, this.keys);
    if (this.player.collisionThisFrame) {
      this.shake = Math.min(2.8, 0.6 + this.player.collisionSpeed * 0.09);
      this.flashHit();
      this.notify('CRASH!  -$150', 'pink');
      this.cash = Math.max(0, this.cash - 150);
    }

    // ---- AI vehicles with collision ----
    this.vehicles.forEach((v, idx) => {
      if (v === this.player.currentVehicle || v.userData.stationary) return;
      const u = v.userData;
      // Steer toward a target heading occasionally
      if (Math.random() < 0.004) u.aiTarget = Math.round(Math.random() * 4) * Math.PI / 2;
      u.aiSpeed += (Math.random() - 0.5) * 2 * dt;
      u.aiSpeed = THREE.MathUtils.clamp(u.aiSpeed, 6, 28);

      v.rotation.y += THREE.MathUtils.clamp(u.aiTarget - v.rotation.y, -dt, dt);

      const nx = v.position.x + Math.sin(v.rotation.y) * u.aiSpeed * dt;
      const nz = v.position.z + Math.cos(v.rotation.y) * u.aiSpeed * dt;
      const res = this.city.resolveCircle(nx, nz, 26);
      if (res.hit) u.aiTarget += Math.PI / 2 + (Math.random() - 0.5);
      v.position.x = res.x;
      v.position.z = res.z;
      v.position.y = 15;

      // Vehicle vs player vehicle
      if (this.player.currentVehicle && this.player.currentVehicle !== v) {
        const pv = this.player.currentVehicle;
        const d = Math.hypot(pv.position.x - v.position.x, pv.position.z - v.position.z);
        if (d < 70 && d > 0.01) {
          const push = (70 - d) / d;
          pv.position.x += (pv.position.x - v.position.x) * push * 0.5;
          pv.position.z += (pv.position.z - v.position.z) * push * 0.5;
          if (Math.abs(this.player.speed) > 12) {
            this.shake = Math.min(3, 1 + Math.abs(this.player.speed) * 0.06);
            this.player.damage(Math.abs(this.player.speed) * 0.4);
            this.addWanted(1);
            this.flashHit();
            this.player.speed *= 0.4;
          }
        }
      }

      // Wrap AI vehicles far away
      if (Math.abs(v.position.x) > 2100 || Math.abs(v.position.z) > 2100) {
        v.position.set((Math.random() - 0.5) * 1200, 15, (Math.random() - 0.5) * 1200);
      }
    });

    // ---- Pedestrians ----
    this.pedestrians.forEach(p => {
      if (!p.alive) {
        p.knocked -= dt;
        p.mesh.rotation.z = Math.min(Math.PI / 2, p.mesh.rotation.z + dt * 4);
        p.mesh.position.y = Math.max(-4, p.mesh.position.y - dt * 18);
        if (p.knocked <= 0) {
          p.alive = true;
          p.mesh.rotation.z = 0;
          p.mesh.position.set((Math.random() - 0.5) * 1200, 0, (Math.random() - 0.5) * 1200);
        }
        return;
      }

      p.vx += (Math.random() - 0.5) * 6 * dt;
      p.vz += (Math.random() - 0.5) * 6 * dt;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 9) { p.vx *= 9 / sp; p.vz *= 9 / sp; }

      const res = this.city.resolveCircle(p.mesh.position.x + p.vx * dt, p.mesh.position.z + p.vz * dt, 5);
      if (res.hit) { p.vx *= -1; p.vz *= -1; }
      p.mesh.position.x = res.x;
      p.mesh.position.z = res.z;
      p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
      animatePedestrian(p.mesh, sp, dt);

      const pv = this.player.currentVehicle;
      const px = pv ? pv.position.x : this.player.position.x;
      const pz = pv ? pv.position.z : this.player.position.z;
      const dp = Math.hypot(p.mesh.position.x - px, p.mesh.position.z - pz);
      const thresh = pv ? 45 : 12;
      if (dp < thresh && pv && Math.abs(this.player.speed) > 10) {
        p.alive = false;
        p.knocked = 6;
        this.addWanted(1);
        this.shake = Math.min(2.2, 0.5 + Math.abs(this.player.speed) * 0.05);
        this.notify('PEDESTRIAN HIT', 'pink');
      }
    });

    // ---- Wanted decay ----
    if (this.wanted > 0) {
      this.wantedTimer -= dt;
      if (this.wantedTimer <= 0) {
        this.wanted--;
        this.wantedTimer = 14;
        this.updateStars();
      }
    }

    // ---- Camera ----
    this.updateCamera(dt);

    // ---- HUD ----
    this.updateHUD(dt);
    this.drawMinimap();
  }

  flashHit() {
    const el = document.getElementById('ui-overlay');
    if (!el) return;
    el.classList.add('hit');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => el.classList.remove('hit'), 180);
  }

  updateStars() {
    const stars = document.querySelectorAll('#wanted .star');
    stars.forEach((s, i) => s.classList.toggle('off', i >= this.wanted));
  }

  updateCamera(dt) {
    const inVehicle = this.player.inVehicle;
    const target = this.player.position.clone();
    target.y += inVehicle ? 17 : 21;

    // Engine rumble continuously shakes at speed; impacts add a bigger spike
    const engine = inVehicle ? Math.abs(this.player.speed) / this.player.maxSpeed * 0.32 : 0;
    this.shake = Math.max(this.shake, engine);
    this.shake *= Math.pow(0.015, dt);

    // Ideal camera: behind the player, slightly to the right, raised by pitch
    const cp = Math.cos(this.pitch);
    const back = new THREE.Vector3(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dist = inVehicle ? this.camVehicleDistance : this.camDistance;

    const offset = back.clone().multiplyScalar(dist);
    offset.add(right.clone().multiplyScalar(inVehicle ? this.camSide * 0.45 : this.camSide));

    // --- Camera vs world: pull in when a wall is between us and the player ---
    const dir = offset.clone().normalize();
    const allowed = this.city.cameraHit(target, dir, offset.length());
    this.camOccluded = allowed < offset.length() - 0.5;
    if (this.camOccluded) {
      offset.copy(dir).multiplyScalar(Math.max(8, allowed - 3));
    }

    const desired = target.clone().add(offset);
    desired.y = Math.max(desired.y, 7);

    // Frame-rate independent smoothing
    this.camera.position.lerp(desired, 1 - Math.pow(0.0015, dt));

    this.shakeOffset.set(
      (Math.random() - 0.5) * this.shake * 2,
      (Math.random() - 0.5) * this.shake * 2,
      (Math.random() - 0.5) * this.shake * 2
    );
    this.camera.position.add(this.shakeOffset);

    // Aim slightly ahead of the player so they sit off-centre on screen
    const lookAt = target.clone().add(right.clone().multiplyScalar(3));
    lookAt.addScaledVector(this.shakeOffset, 0.35);
    this.camera.lookAt(lookAt);
    if (this.camera.position.y < 6) this.camera.position.y = 6;
  }

  updateHUD(dt) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('health-value', Math.round(this.player.health));
    set('armor-value', Math.round(this.player.armor));
    set('cash-amount', this.cash.toLocaleString('en-US'));

    const hf = document.getElementById('health-fill');
    const af = document.getElementById('armor-fill');
    if (hf) hf.style.width = this.player.health + '%';
    if (af) af.style.width = this.player.armor + '%';

    const mph = Math.round(Math.abs(this.player.speed) * 4.5);
    set('spd-num', mph);
    const spdEl = document.getElementById('speedo');
    if (spdEl) spdEl.classList.toggle('active', this.player.inVehicle);
    const arc = document.getElementById('spd-arc');
    if (arc) {
      const pct = Math.min(1, Math.abs(this.player.speed) / this.player.maxSpeed);
      arc.style.strokeDasharray = `${pct * 405} 541`;
    }
    const gear = document.getElementById('gear');
    if (gear) gear.textContent = this.player.speed < -0.5 ? 'R' : this.player.speed > 0.5 ? 'D' : 'N';

    this.updateStars();

    // District label
    const x = this.player.position.x, z = this.player.position.z;
    let district = '— DOWNTOWN';
    if (z > 700) district = '— VICE BEACH';
    else if (x < -700) district = '— LITTLE HAVANA';
    else if (x > 700) district = '— RICHMAN';
    else if (z < -700) district = '— PORT';
    const d = document.getElementById('district');
    if (d && d.textContent !== district) d.textContent = district;

    // Hint fades
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        const hint = document.getElementById('hint');
        if (hint) hint.style.opacity = '0';
      }
    }
  }

  drawMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const S = canvas.width;
    const mid = S / 2;
    const scale = 0.18;
    const px = this.player.position.x, pz = this.player.position.z;
    // Rotate the map so the player's heading always points up.
    const angle = this.player.inVehicle ? this.player.rotation - Math.PI : this.yaw;

    c.clearRect(0, 0, S, S);

    // Base (water + land)
    c.fillStyle = '#0c2430';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#16262a';
    c.fillRect(0, 0, S, S);

    c.save();
    c.translate(mid, mid);
    c.rotate(angle);

    const map = (wx, wz) => [(wx - px) * scale, (wz - pz) * scale];

    // City blocks (centred between the road grid lines)
    c.fillStyle = '#24343a';
    for (let i = -11; i <= 11; i++) {
      for (let j = -11; j <= 11; j++) {
        const [x, y] = map(i * 200 + 28, j * 200 + 28);
        const sx = 144 * scale, sy = 144 * scale;
        if (x > -S && x < S && y > -S && y < S) c.fillRect(x, y, sx, sy);
      }
    }

    // Roads — casing + inner line, GTA VI-ish pink/peach
    for (let pass = 0; pass < 2; pass++) {
      c.strokeStyle = pass === 0 ? '#0a1418' : '#d16a8f';
      c.lineWidth = pass === 0 ? 11 : 7;
      for (let i = -11; i <= 11; i++) {
        const [x1] = map(i * 200, 0);
        const [, y1] = map(0, i * 200);
        c.beginPath(); c.moveTo(x1, -S); c.lineTo(x1, S); c.stroke();
        c.beginPath(); c.moveTo(-S, y1); c.lineTo(S, y1); c.stroke();
      }
    }

    // Pedestrians
    c.fillStyle = 'rgba(255,255,255,.45)';
    this.pedestrians.forEach(p => {
      if (!p.alive) return;
      const [x, y] = map(p.mesh.position.x, p.mesh.position.z);
      if (Math.abs(x) < mid && Math.abs(y) < mid) c.fillRect(x - 1, y - 1, 2, 2);
    });

    // Vehicles
    this.vehicles.forEach(v => {
      const [x, y] = map(v.position.x, v.position.z);
      if (Math.abs(x) > mid || Math.abs(y) > mid) return;
      c.fillStyle = '#4fe0ff';
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill();
    });

    c.restore();

    // Player arrow (always up)
    c.save();
    c.translate(mid, mid);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ff2e63';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -13); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10);
    c.closePath(); c.fill(); c.stroke();
    c.restore();

    // Radar sweep
    const t = (performance.now() % 3000) / 3000;
    c.save();
    c.translate(mid, mid);
    c.rotate(t * Math.PI * 2);
    const grad = c.createLinearGradient(0, 0, mid, 0);
    grad.addColorStop(0, 'rgba(255,92,168,0)');
    grad.addColorStop(1, 'rgba(255,92,168,.10)');
    c.fillStyle = grad;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, mid, -0.35, 0.35); c.closePath(); c.fill();
    c.restore();
  }

  draw() {
    const dirLight = this.scene.children.find(c => c.isDirectionalLight);
    if (dirLight) {
      dirLight.position.set(this.player.position.x + 80, 140, this.player.position.z + 60);
      dirLight.target.position.copy(this.player.position);
      dirLight.target.updateMatrixWorld();
    }
  }
}
