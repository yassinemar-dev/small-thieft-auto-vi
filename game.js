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

    // Vehicles — start with a visible flow of traffic around the spawn point,
    // then fill the rest of the city. All spawns are on clear road lanes.
    this.vehicles = [];
    for (let i = 0; i < 34; i++) {
      let x, z, dir;
      if (i < 20) {
        // Four lanes on each of the five closest N/S and E/W avenues.
        const grid = (Math.floor(i / 4) - 2) * 200;
        const along = ((i % 4) - 1.5) * 260 - 28;
        const vertical = i % 2 === 0;
        const lane = (i % 4 < 2) ? -8 : -48;
        if (vertical) { x = grid + lane; z = along; dir = lane === -8 ? 0 : Math.PI; }
        else { x = along; z = grid + lane; dir = lane === -8 ? Math.PI / 2 : -Math.PI / 2; }
      }
      this.vehicles.push(this.createVehicle(x, z, dir));
    }
    // Park the starter car ahead of the player (-Z is forward). Spawning it
    // behind at +50 put the over-the-shoulder camera inside its cabin.
    const starter = this.createVehicle(0, -80, 0);
    starter.userData.stationary = true; // wait at the spawn point for the player
    this.vehicles.push(starter);

    // Pedestrians
    this.pedestrians = [];
    for (let i = 0; i < 44; i++) this.pedestrians.push(this.createPedestrian());

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

  createVehicle(x, z, dir) {
    const color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
    const car = createCar(color);
    const spot = this.city.roadSpawn(x, z);
    car.position.set(spot.x, 15, spot.z);
    car.rotation.y = dir !== undefined ? dir : spot.dir + (Math.random() > 0.5 ? Math.PI : 0);
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

    // ---- AI traffic: lanes, intersection turns and spacing ----
    const DIRS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const LANES = [-8, -48]; // the avenue surface runs from gridLine-56 to gridLine
    const nearestLane = value => LANES.reduce((a, b) =>
      Math.abs(value - b) < Math.abs(value - a) ? b : a);
    const time = performance.now() / 1000;
    this.city.updateTrafficLights(time);

    this.vehicles.forEach((v) => {
      if (v === this.player.currentVehicle || v.userData.stationary) return;
      const u = v.userData;
      u.frameSpeed = u.aiSpeed || 0;

      if (u.aiDir === undefined) {
        u.aiDir = DIRS[Math.round(v.rotation.y / (Math.PI / 2)) & 3];
        const alongZ = Math.abs(Math.sin(u.aiDir)) < 0.5;
        const line = alongZ ? Math.round(v.position.x / 200) * 200 : Math.round(v.position.z / 200) * 200;
        const offset = alongZ ? v.position.x - line : v.position.z - line;
        u.aiLane = nearestLane(offset);
        u.aiSpeed = 12 + Math.random() * 10;
        u.cruise = 11 + Math.random() * 13;
        u.lastCross = null;
      }

      const alongZ = Math.abs(Math.sin(u.aiDir)) < 0.5;
      const line = alongZ ? Math.round(v.position.x / 200) * 200 : Math.round(v.position.z / 200) * 200;
      const lane = u.aiLane !== undefined ? u.aiLane : -8;

      // Ease back onto the lane centre after a turn or a collision
      if (alongZ) v.position.x += (line + lane - v.position.x) * Math.min(1, dt * 3);
      else v.position.z += (line + lane - v.position.z) * Math.min(1, dt * 3);

      // Slow down for a car ahead in the same lane instead of piling up
      let targetSpeed = u.cruise;
      const fx = Math.sin(u.aiDir), fz = Math.cos(u.aiDir);
      for (const other of this.vehicles) {
        if (other === v || other.userData.stationary) continue;
        const dx = other.position.x - v.position.x, dz = other.position.z - v.position.z;
        const ahead = dx * fx + dz * fz;
        const lateral = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 90 && lateral < 24) {
          targetSpeed = Math.min(targetSpeed, (other.userData.aiSpeed || 12) * 0.72);
        }
      }

      // Obey the red light as the car approaches an intersection
      const travel = alongZ ? v.position.z : v.position.x;
      const crossLine = Math.round((travel + 28) / 200) * 200;
      const crossCenter = crossLine - 28;
      const ix = Math.round((alongZ ? v.position.x : v.position.z) / 200);
      const iz = Math.round((alongZ ? v.position.z : v.position.x) / 200);
      const green = (((ix + iz) & 1) ^ (Math.floor(time / 4) & 1)) === 1;
      if (Math.abs(travel - crossCenter) < 58 && !green) targetSpeed = 0;

      u.aiSpeed += (targetSpeed - u.aiSpeed) * Math.min(1, dt * 2.2);
      u.aiSpeed = THREE.MathUtils.clamp(u.aiSpeed, 0, 30);

      const nx = v.position.x + fx * u.aiSpeed * dt;
      const nz = v.position.z + fz * u.aiSpeed * dt;
      const res = this.city.resolveCircle(nx, nz, 26);
      if (res.hit) {
        u.aiLane = nearestLane(alongZ ? v.position.x - line : v.position.z - line);
        u.aiSpeed *= 0.35;
        u.lastCross = null;
      }
      v.position.x = res.x;
      v.position.z = res.z;
      v.position.y = 15;
      v.rotation.y = u.aiDir;

      // Turn at the next intersection
      if (Math.abs(travel - crossCenter) < 12 && u.lastCross !== crossCenter) {
        u.lastCross = crossCenter;
        let choices = DIRS.filter(dir => {
          const diff = Math.abs(Math.atan2(Math.sin(dir - u.aiDir), Math.cos(dir - u.aiDir)));
          return diff > 0.8 && diff < 2.5; // perpendicular turns only
        });
        if (Math.random() < 0.3) choices = choices.concat(u.aiDir); // sometimes go straight
        u.aiDir = choices[(Math.random() * choices.length) | 0] || u.aiDir;
        u.aiLane = nearestLane(-8 + (Math.random() > 0.5 ? 0 : -40));
        const xLine = Math.round(v.position.x / 200) * 200;
        const zLine = Math.round(v.position.z / 200) * 200;
        if (Math.abs(Math.sin(u.aiDir)) < 0.5) {
          v.position.set(xLine + u.aiLane, 15, crossCenter + Math.cos(u.aiDir) * 14);
        } else {
          v.position.set(crossCenter + Math.sin(u.aiDir) * 14, 15, zLine + u.aiLane);
        }
        v.rotation.y = u.aiDir;
      }

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

      // Recycle far-away traffic onto a clean road lane
      if (Math.abs(v.position.x) > 2100 || Math.abs(v.position.z) > 2100) {
        const spot = this.city.roadSpawn();
        v.position.set(spot.x, 15, spot.z);
        u.aiDir = spot.dir;
        u.aiLane = nearestLane(spot.x - Math.round(spot.x / 200) * 200);
        u.lastCross = null;
      }
    });

    // Traffic should never drive through an pedestrian on foot
    if (!this.player.inVehicle) {
      this.playerCarCooldown = Math.max(0, (this.playerCarCooldown || 0) - dt);
      for (const car of this.vehicles) {
        const dx = this.player.position.x - car.position.x;
        const dz = this.player.position.z - car.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 30 && d > 0.01) {
          const push = (30 - d) / d;
          this.player.position.x += dx * push;
          this.player.position.z += dz * push;
          const res = this.city.resolveCircle(this.player.position.x, this.player.position.z, this.player.radius);
          this.player.position.x = res.x;
          this.player.position.z = res.z;
          const carSpeed = car.userData.stationary ? 0 : (car.userData.frameSpeed || car.userData.aiSpeed || 0);
          if (carSpeed > 14 && this.playerCarCooldown <= 0) {
            this.player.damage(carSpeed * 0.3);
            this.shake = Math.min(2.2, 0.6 + carSpeed * 0.07);
            this.flashHit();
            this.playerCarCooldown = 1.2;
          }
        }
      }
    }

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

      // Bots actually react to traffic now — step aside when a car is close
      for (const car of this.vehicles) {
        const dx = p.mesh.position.x - car.position.x;
        const dz = p.mesh.position.z - car.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 60 && d > 0.01) {
          p.vx += (dx / d) * (60 - d) * 0.4 * dt;
          p.vz += (dz / d) * (60 - d) * 0.4 * dt;
        }
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
