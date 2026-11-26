import * as THREE from 'three';
import { City } from './city.js';
import { Player } from './player.js';
import { createCarProxy, CarFleet, createPedestrianProxy, PedestrianCrowd } from './models.js';

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
    for (let i = 0; i < 42; i++) {
      let x, z, dir;
      if (i < 28) {
        // Two lanes per direction on the seven closest N/S and E/W avenues.
        const grid = (Math.floor(i / 4) - 3) * 200;
        const along = ((i % 4) - 1.5) * 260 - 28;
        const vertical = i % 2 === 0;
        const forward = i % 4 < 2;
        if (vertical) {
          dir = forward ? 0 : Math.PI;
          x = grid + City.laneOffset(dir); z = along;
        } else {
          dir = forward ? Math.PI / 2 : -Math.PI / 2;
          x = along; z = grid + City.laneOffset(dir);
        }
      }
      this.vehicles.push(this.createVehicle(x, z, dir));
    }
    // Park the starter car ahead of the player (-Z is forward). Spawning it
    // behind at +50 put the over-the-shoulder camera inside its cabin.
    const starter = this.createVehicle(0, -80, 0);
    starter.userData.stationary = true; // wait at the spawn point for the player
    this.vehicles.push(starter);
    // One instanced mesh per car part instead of ~900 individual meshes
    this.cars = new CarFleet(this.vehicles, this.scene);

    // Pedestrians — most start close to the player so the sidewalks feel alive
    this.pedestrians = [];
    for (let i = 0; i < 64; i++) {
      const ped = this.createPedestrian();
      this.placePedestrian(ped, i < 46);
      this.pedestrians.push(ped);
    }
    // One instanced mesh per body part instead of ~600 individual draw calls
    this.crowd = new PedestrianCrowd(this.pedestrians.map(p => p.mesh), this.scene);

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
    this.crashCooldown = 0;
    this.deathActive = false;
    this.deadTimer = 0;
    this.policeCars = [];
    this.cash = 12450;
    this.keys = {};
    this.prevF = false;
    this.prevR = false;
    this.prevM = false;
    this.paused = false;
    this.hintTimer = 12;

    // Mission: a five-checkpoint Vice Run through the city
    this.mission = { active: false, index: 0, time: 0, completed: 0 };
    this.checkpoints = [];
    this.missionCooldown = 0;
    this.createMissionMarker();

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;
      if (!e.repeat && (key === 'p' || key === 'escape')) this.togglePause();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });

    this.initHUD();
    this.startMission();
  }

  /** A single glowing beacon reused for every checkpoint. */
  createMissionMarker() {
    const marker = new THREE.Group();
    const cyan = 0x35f0ff;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(30, 2.2, 8, 40),
      new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 3;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 30, 120, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: cyan, transparent: true, opacity: 0.16, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false
      })
    );
    beam.position.y = 60;
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(13, 22, 16),
      new THREE.MeshBasicMaterial({ color: cyan, toneMapped: false })
    );
    arrow.rotation.x = Math.PI;
    arrow.position.y = 128;
    marker.add(ring, beam, arrow);
    marker.visible = false;
    this.scene.add(marker);
    this.missionMarker = marker;
    this.markerParts = { ring, beam, arrow };
  }

  createVehicle(x, z, dir) {
    const color = CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
    const car = createCarProxy(color);
    const spot = this.city.roadSpawn(x, z);
    car.position.set(spot.x, 15, spot.z);
    car.rotation.y = dir !== undefined ? dir : spot.dir + (Math.random() > 0.5 ? Math.PI : 0);
    car.userData.aiSpeed = 12 + Math.random() * 10;
    car.userData.aiTarget = car.rotation.y;
    car.userData.originalColor = car.userData.paint.color.clone();
    return car;
  }

  createPedestrian() {
    const mesh = createPedestrianProxy();
    return { mesh, vx: 0, vz: 0, alive: true, knocked: 0, panic: 0, panicDir: 0 };
  }

  /** Put a walker on a sidewalk lane, facing a steady direction. */
  placePedestrian(p, near = false) {
    const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const dir = dirs[(Math.random() * dirs.length) | 0];
    const alongZ = Math.abs(Math.sin(dir)) < 0.5;
    const span = near ? 3 : 10;
    const grid = (((Math.random() * (span * 2 + 1)) | 0) - span) * 200;
    const along = (Math.random() - 0.5) * (near ? 1100 : 2000);
    const side = City.sidewalkOffset(dir); // outside pavement strip, clear of cars
    p.mesh.position.set(alongZ ? grid + side : along, 0, alongZ ? along : grid + side);
    p.mesh.rotation.set(0, dir, 0);
    p.routeDir = dir;
    p.laneSide = side;
    p.routeSpeed = 4 + Math.random() * 4;
    p.lastCross = null;
    p.vx = Math.sin(dir) * p.routeSpeed;
    p.vz = Math.cos(dir) * p.routeSpeed;
    p.alive = true;
    p.knocked = 0;
    p.panic = 0;
    p.mesh.userData.panic = 0;
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
    document.querySelectorAll('[data-pause-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-pause-action');
        if (action === 'resume') this.setPaused(false);
        else if (action === 'restart') this.restartGame();
      });
    });
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.keys = {};
    this.prevF = this.prevR = this.prevM = true;
    const screen = document.getElementById('pause-screen');
    if (screen) screen.classList.toggle('show', paused);
    if (paused) this.audio?.silence();
    if (paused && document.pointerLockElement) document.exitPointerLock();
    if (!paused && !this.player.dead) {
      const canvas = document.getElementById('game-canvas');
      if (canvas && canvas.requestPointerLock) {
        try {
          const lock = canvas.requestPointerLock();
          if (lock && lock.catch) lock.catch(() => {});
        } catch (_) { /* pointer lock needs a trusted click; ignore */ }
      }
    }
  }

  togglePause() { this.setPaused(!this.paused); }

  /** Full restart from the pause menu: no hospital fee, fresh run. */
  restartGame() {
    const p = this.player;
    p.dead = false;
    p.health = 100;
    p.armor = 100;
    p.speed = 0;
    p.inVehicle = false;
    p.currentVehicle = null;
    p.character.visible = true;
    p.shadow.visible = true;
    const spot = this.city.roadSpawn(0, 0);
    p.position.set(spot.x, 0, spot.z);
    p.rotation = spot.dir;
    p.character.position.copy(p.position);
    p.shadow.position.set(p.position.x, 0.08, p.position.z);

    this.cash = 12450;
    this.wanted = 0;
    this.wantedTimer = 0;
    this.crashCooldown = 0;
    this.deathActive = false;
    this.deadTimer = 0;
    const death = document.getElementById('death-screen');
    if (death) death.classList.remove('show');
    this.mission.completed = 0;
    this.missionCooldown = 0;
    this.startMission();
    this.setPaused(false);
    this.notify('NEW RUN', 'green');
  }

  /** Start a fresh checkpoint route near the city centre. */
  startMission() {
    const anchors = [[220, 220], [420, -180], [180, -420], [-220, -220], [-420, 180]];
    this.checkpoints = anchors.map(([x, z]) => {
      const spot = this.city.roadSpawn(x, z);
      return { x: spot.x, z: spot.z };
    });
    this.mission.active = true;
    this.mission.index = 0;
    this.mission.time = 0;
    this.missionCooldown = 0;
    this.placeMissionMarker();
    this.notify('VICE RUN  —  5 CHECKPOINTS', 'green');
  }

  placeMissionMarker() {
    const cp = this.checkpoints[this.mission.index];
    if (!cp) { this.missionMarker.visible = false; return; }
    this.missionMarker.position.set(cp.x, 0, cp.z);
    this.missionMarker.visible = true;
  }

  missionBonus() {
    return Math.max(500, 2500 - Math.floor(this.mission.time) * 20);
  }

  updateMission(dt) {
    const m = this.mission;
    if (!m.active) {
      if (this.missionCooldown > 0) {
        this.missionCooldown -= dt;
        if (this.missionCooldown <= 0) this.startMission();
      }
      return;
    }
    m.time += dt;
    const cp = this.checkpoints[m.index];
    if (cp && Math.hypot(this.player.position.x - cp.x, this.player.position.z - cp.z) < 55) {
      this.cash += 400;
      m.index++;
      if (m.index >= this.checkpoints.length) {
        m.active = false;
        m.completed++;
        const bonus = this.missionBonus();
        this.cash += bonus;
        this.missionCooldown = 4;
        this.missionMarker.visible = false;
        this.notify(`MISSION COMPLETE  +$${bonus}`, 'green');
        this.audio?.complete();
      } else {
        this.placeMissionMarker();
        this.notify(`CHECKPOINT ${m.index}/${this.checkpoints.length}  +$400`, 'green');
        this.audio?.checkpoint();
      }
    }
    if (this.missionMarker.visible) {
      const t = performance.now() / 1000;
      this.missionMarker.rotation.y = t * 0.8;
      this.markerParts.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
      this.markerParts.arrow.position.y = 128 + Math.sin(t * 3) * 8;
    }
  }

  addWanted(n) {
    this.wanted = Math.min(5, this.wanted + n);
    this.wantedTimer = 16;
    this.notify('WANTED LEVEL ' + this.wanted, 'pink');
    this.audio?.wanted();
  }

  /** Promote nearby traffic into a pursuing police fleet for the wanted level. */
  syncPolice() {
    const target = Math.min(this.wanted, 5);
    while (this.policeCars.length < target) {
      const p = this.player.position;
      const car = this.vehicles
        .filter(v => !v.userData.stationary && !v.userData.police && v !== this.player.currentVehicle)
        .sort((a, b) => Math.hypot(a.position.x - p.x, a.position.z - p.z)
                      - Math.hypot(b.position.x - p.x, b.position.z - p.z))[0];
      if (!car) break;
      car.userData.police = true;
      car.userData.paint.color.setHex(0xf1f5f9);
      car.userData.aiSpeed = Math.max(car.userData.aiSpeed, 18);
      this.policeCars.push(car);
    }
    while (this.policeCars.length > target) {
      const car = this.policeCars.pop();
      car.userData.police = false;
      car.userData.paint.color.copy(car.userData.originalColor);
      car.userData.lastCross = null;
    }
  }

  /** Simple pursuit steering: home in on the player and ram on contact. */
  updatePoliceCar(v, dt) {
    const u = v.userData, p = this.player.position;
    const desired = Math.atan2(p.x - v.position.x, p.z - v.position.z);
    const diff = Math.atan2(Math.sin(desired - u.aiDir), Math.cos(desired - u.aiDir));
    u.aiDir += diff * Math.min(1, dt * 2.2);
    const target = Math.min(32, 20 + this.wanted * 2);
    u.aiSpeed += (target - u.aiSpeed) * Math.min(1, dt * 2);
    u.frameSpeed = u.aiSpeed;
    u.brake = false;
    (u.wheels || []).forEach(w => { w.rotation.z += u.aiSpeed * dt * 0.11; });

    const nx = v.position.x + Math.sin(u.aiDir) * u.aiSpeed * dt;
    const nz = v.position.z + Math.cos(u.aiDir) * u.aiSpeed * dt;
    const res = this.city.resolveCircle(nx, nz, 14);
    if (res.hit) u.aiSpeed *= 0.5;
    v.position.set(res.x, 15, res.z);
    v.rotation.y = u.aiDir;

    const pv = this.player.currentVehicle;
    if (pv && pv !== v) {
      const d = Math.hypot(pv.position.x - v.position.x, pv.position.z - v.position.z);
      if (d < 55 && d > 0.01 && this.crashCooldown <= 0) {
        this.crashCooldown = 1.2;
        const push = (55 - d) / d * 0.6;
        pv.position.x += (pv.position.x - v.position.x) * push;
        pv.position.z += (pv.position.z - v.position.z) * push;
        this.player.damage(8);
        u.damage = Math.min(1, (u.damage || 0) + 0.08);
        pv.userData.damage = Math.min(1, (pv.userData.damage || 0) + 0.12);
        this.shake = Math.min(3, 1.2 + Math.abs(this.player.speed) * 0.04);
        this.flashHit();
        this.audio?.crash();
        this.player.speed *= 0.7;
      }
    }

    if (Math.abs(v.position.x) > 2100 || Math.abs(v.position.z) > 2100) {
      const spot = this.city.roadSpawn();
      v.position.set(spot.x, 15, spot.z);
      u.aiDir = spot.dir;
      u.aiLane = City.laneOffset(spot.dir);
    }
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    this.syncPolice();

    if (this.player.dead) {
      if (!this.deathActive) this.beginDeath();
      this.deadTimer += dt;
      this.updateCamera(dt);
      this.updateHUD(dt);
      if (this.deadTimer >= 2.4) this.respawnPlayer();
      return;
    }

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
      const car = this.player.currentVehicle;
      const damaged = this.player.health < 100 || this.player.armor < 100 ||
        (car && (car.userData.damage || 0) > 0);
      if (damaged) {
        this.player.repair();
        this.notify('REPAIRED', 'green');
        this.audio?.repair();
      } else {
        this.notify('NO DAMAGE');
      }
    }
    this.prevR = r;

    const m = !!this.keys['m'];
    if (m && !this.prevM) {
      this.missionCooldown = 0;
      this.startMission();
    }
    this.prevM = m;

    // ---- Player + collision ----
    this.player.update(dt, this.yaw, this.keys);
    if (this.player.collisionThisFrame && this.crashCooldown <= 0) {
      this.crashCooldown = 1.2;
      this.shake = Math.min(2.8, 0.6 + this.player.collisionSpeed * 0.09);
      this.flashHit();
      this.notify('CRASH!  -$150', 'pink');
      this.audio?.crash();
      this.cash = Math.max(0, this.cash - 150);
    }

    // ---- AI traffic: lanes, intersection turns and spacing ----
    const DIRS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const time = performance.now() / 1000;
    this.city.updateTrafficLights(time);

    this.vehicles.forEach((v) => {
      if (v === this.player.currentVehicle || v.userData.stationary) return;
      if (v.userData.police) { this.updatePoliceCar(v, dt); return; }
      const u = v.userData;
      u.frameSpeed = u.aiSpeed || 0;

      if (u.aiDir === undefined) {
        u.aiDir = DIRS[Math.round(v.rotation.y / (Math.PI / 2)) & 3];
        u.aiLane = City.laneOffset(u.aiDir);
        u.aiSpeed = 12 + Math.random() * 10;
        u.cruise = 11 + Math.random() * 13;
        u.lastCross = null;
      }

      const alongZ = Math.abs(Math.sin(u.aiDir)) < 0.5;
      const line = alongZ ? Math.round(v.position.x / 200) * 200 : Math.round(v.position.z / 200) * 200;
      const lane = u.aiLane !== undefined ? u.aiLane : City.laneOffset(u.aiDir);

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
          targetSpeed = Math.min(targetSpeed, (other.userData.aiSpeed ?? 12) * 0.72);
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
      u.frameSpeed = u.aiSpeed;
      u.brake = targetSpeed < u.cruise * 0.7;
      (v.userData.wheels || []).forEach(w => { w.rotation.z += u.aiSpeed * dt * 0.11; });

      const nx = v.position.x + fx * u.aiSpeed * dt;
      const nz = v.position.z + fz * u.aiSpeed * dt;
      const res = this.city.resolveCircle(nx, nz, 14);
      if (res.hit) {
        u.aiLane = City.laneOffset(u.aiDir);
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
        u.aiLane = City.laneOffset(u.aiDir);
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
          if (Math.abs(this.player.speed) > 12 && this.crashCooldown <= 0) {
            this.crashCooldown = 1.2;
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
        u.aiLane = City.laneOffset(spot.dir);
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
    // Fast cars and police sirens make nearby walkers scatter.
    const threats = [];
    if (this.player.inVehicle && Math.abs(this.player.speed) > 18) {
      threats.push({ x: this.player.position.x, z: this.player.position.z, radius: 135 });
    }
    this.policeCars.forEach(car => {
      threats.push({ x: car.position.x, z: car.position.z, radius: 175 });
    });

    this.pedestrians.forEach(p => {
      if (!p.alive) {
        p.knocked -= dt;
        p.mesh.rotation.z = Math.min(Math.PI / 2, p.mesh.rotation.z + dt * 4);
        p.mesh.position.y = Math.max(-4, p.mesh.position.y - dt * 18);
        if (p.knocked <= 0) {
          p.mesh.rotation.z = 0;
          this.placePedestrian(p, Math.random() > 0.35);
        }
        return;
      }

      // Walkers keep to a sidewalk lane instead of wandering through walls
      const dir = p.routeDir !== undefined ? p.routeDir : Math.atan2(p.vx, p.vz);
      const alongZ = Math.abs(Math.sin(dir)) < 0.5;
      const line = alongZ
        ? Math.round(p.mesh.position.x / 200) * 200
        : Math.round(p.mesh.position.z / 200) * 200;
      const lane = line + (p.laneSide ?? City.sidewalkOffset(dir));
      if (alongZ) p.mesh.position.x += (lane - p.mesh.position.x) * Math.min(1, dt * 3);
      else p.mesh.position.z += (lane - p.mesh.position.z) * Math.min(1, dt * 3);

      // React to danger: run away from the closest fast car or cruiser
      let threat = null, nearest = Infinity;
      for (const t of threats) {
        const dx = p.mesh.position.x - t.x, dz = p.mesh.position.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < t.radius && d < nearest) { nearest = d; threat = { x: dx, z: dz }; }
      }
      if (threat) {
        p.panic = 2.2;
        p.panicDir = Math.atan2(threat.x, threat.z);
      } else {
        p.panic = Math.max(0, p.panic - dt);
      }
      p.mesh.userData.panic = p.panic;

      // Desired pace along the sidewalk, with a gentle dodge for nearby cars
      let ax, az;
      if (p.panic > 0) {
        ax = Math.sin(p.panicDir) * p.routeSpeed * 2.4;
        az = Math.cos(p.panicDir) * p.routeSpeed * 2.4;
      } else {
        ax = Math.sin(dir) * p.routeSpeed;
        az = Math.cos(dir) * p.routeSpeed;
      }
      for (const car of this.vehicles) {
        const dx = p.mesh.position.x - car.position.x;
        const dz = p.mesh.position.z - car.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 45 && d > 0.01) {
          ax += (dx / d) * (45 - d) * 0.28;
          az += (dz / d) * (45 - d) * 0.28;
        }
      }
      ax += (Math.random() - 0.5) * 2;
      az += (Math.random() - 0.5) * 2;
      p.vx += (ax - p.vx) * Math.min(1, dt * 5);
      p.vz += (az - p.vz) * Math.min(1, dt * 5);
      const sp = Math.hypot(p.vx, p.vz);
      const maxSp = p.routeSpeed * (p.panic > 0 ? 2.6 : 1.8);
      if (sp > maxSp) { p.vx *= maxSp / sp; p.vz *= maxSp / sp; }

      const res = this.city.resolveCircle(p.mesh.position.x + p.vx * dt, p.mesh.position.z + p.vz * dt, 5);
      if (res.hit) {
        p.routeDir = dir + Math.PI;
        p.vx *= -1; p.vz *= -1;
        p.lastCross = null;
      }
      p.mesh.position.x = res.x;
      p.mesh.position.z = res.z;
      p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
      this.crowd.animate(p.mesh, Math.hypot(p.vx, p.vz), dt);

      // At the next corner some walkers turn down the cross street
      const travel = alongZ ? p.mesh.position.z : p.mesh.position.x;
      const nextLine = Math.round((travel + 28) / 200) * 200;
      const crossCenter = nextLine - 28;
      if (Math.abs(travel - crossCenter) < 10 && p.lastCross !== crossCenter) {
        p.lastCross = crossCenter;
        if (Math.random() < 0.35) {
          if (alongZ) p.routeDir = Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2;
          else p.routeDir = Math.random() > 0.5 ? 0 : Math.PI;
          p.laneSide = City.sidewalkOffset(p.routeDir);
          if (alongZ) {
            p.mesh.position.set(
              crossCenter + Math.sin(p.routeDir) * 10, 0, nextLine + p.laneSide
            );
          } else {
            p.mesh.position.set(
              nextLine + p.laneSide, 0, crossCenter + Math.cos(p.routeDir) * 10
            );
          }
          p.vx = Math.sin(p.routeDir) * p.routeSpeed;
          p.vz = Math.cos(p.routeDir) * p.routeSpeed;
          p.mesh.rotation.y = p.routeDir;
        }
      }

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
        this.audio?.hit();
      }
    });
    this.crowd.sync();
    this.cars.sync();

    // ---- Wanted decay ----
    if (this.wanted > 0) {
      this.wantedTimer -= dt;
      if (this.wantedTimer <= 0) {
        this.wanted--;
        this.wantedTimer = 14;
        this.updateStars();
      }
    }

    // ---- Mission checkpoints ----
    this.updateMission(dt);

    // ---- Camera ----
    this.updateCamera(dt);

    // ---- HUD ----
    this.updateHUD(dt);
    this.drawMinimap();
  }

  /** Show the wasted screen and freeze gameplay until the hospital respawn. */
  beginDeath() {
    this.deathActive = true;
    this.deadTimer = 0;
    this.keys = {};
    this.prevF = this.prevR = true;
    this.player.speed = 0;
    const el = document.getElementById('death-screen');
    if (el) el.classList.add('show');
    this.notify('WASTED', 'pink');
    this.audio?.death();
  }

  /** Respawn near the starter car, clear the heat and charge a hospital bill. */
  respawnPlayer() {
    const el = document.getElementById('death-screen');
    if (el) el.classList.remove('show');
    this.deathActive = false;
    this.deadTimer = 0;

    const p = this.player;
    p.dead = false;
    p.health = 100;
    p.armor = 100;
    p.speed = 0;
    p.inVehicle = false;
    p.currentVehicle = null;
    p.character.visible = true;
    p.shadow.visible = true;

    const spot = this.city.roadSpawn(0, 0);
    p.position.set(spot.x, 0, spot.z);
    p.rotation = spot.dir;
    p.character.position.copy(p.position);
    p.shadow.position.set(p.position.x, 0.08, p.position.z);

    this.wanted = 0;
    this.wantedTimer = 0;
    this.cash = Math.max(0, this.cash - 500);
    this.crashCooldown = 2;
    this.keys = {};
    this.prevF = this.prevR = true;
    this.notify('HOSPITAL BILL  -$500', 'pink');
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
    const overlay = document.getElementById('ui-overlay');
    if (overlay) overlay.classList.toggle('critical', this.player.health <= 30 && !this.player.dead);

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

    // Mission panel
    const mt = document.getElementById('mission-title');
    const mo = document.getElementById('mission-objective');
    const mm = document.getElementById('mission-meta');
    if (mt && mo && mm) {
      const m = this.mission;
      if (m.active) {
        mt.textContent = 'VICE RUN';
        mo.textContent = `CHECKPOINT ${m.index + 1} / ${this.checkpoints.length}`;
        const secs = String(Math.floor(m.time % 60)).padStart(2, '0');
        const mins = String(Math.floor(m.time / 60)).padStart(2, '0');
        mm.textContent = `${mins}:${secs}   ·   BONUS $${this.missionBonus()}`;
      } else {
        mt.textContent = 'MISSION COMPLETE';
        mo.textContent = 'PRESS M FOR ANOTHER RUN';
        mm.textContent = `RUNS COMPLETED  ${m.completed}`;
      }
    }

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

    // Keep the compass marker honest while the map rotates under the player.
    const north = document.getElementById('map-north');
    if (north) {
      const size = canvas.clientWidth || 210;
      const midCss = size / 2;
      const radius = midCss - 13;
      north.style.left = `${midCss + Math.sin(angle) * radius}px`;
      north.style.top = `${midCss - Math.cos(angle) * radius}px`;
      north.style.transform = 'translate(-50%, -50%)';
    }

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

    // Active checkpoint
    if (this.mission.active && this.checkpoints[this.mission.index]) {
      const cp = this.checkpoints[this.mission.index];
      const [x, y] = map(cp.x, cp.z);
      if (Math.abs(x) < mid && Math.abs(y) < mid) {
        const pulse = 11 + Math.sin(performance.now() * 0.005) * 3;
        c.strokeStyle = 'rgba(53,240,255,.8)';
        c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, pulse, 0, Math.PI * 2); c.stroke();
        c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
        c.fillStyle = '#35f0ff'; c.fillRect(-6, -6, 12, 12); c.restore();
      }
    }

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
      // Match the visible sun: low sunset light from -X/-Z, with long raking shadows
      dirLight.position.set(this.player.position.x - 280, 160, this.player.position.z - 400);
      dirLight.target.position.copy(this.player.position);
      dirLight.target.updateMatrixWorld();
    }
  }
}
