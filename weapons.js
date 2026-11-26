/** Lightweight drive-by pistol: pooled tracers, sparks and a shared muzzle flash. */
import * as THREE from 'three';

const MAX_TRACERS = 48;
const MAX_ENEMY_TRACERS = 24;
const MAX_SPARKS = 24;
const TRACER_LENGTH = 12;
const BULLET_SPEED = 520;

function radialTexture(stops) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 1, 32, 32, 32);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class WeaponSystem {
  constructor(scene) {
    this.scene = scene;
    this.magSize = 12;
    this.ammo = this.magSize;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.heatCooldown = 0;
    this.muzzleLife = 0;
    this.bullets = [];
    this.enemyShots = [];

    this.dummy = new THREE.Object3D();
    this.axis = new THREE.Vector3(0, 0, 1);
    this.tmp = new THREE.Vector3();

    // One instanced draw call for every tracer in flight
    const tracerGeo = new THREE.BoxGeometry(0.7, 0.7, TRACER_LENGTH);
    tracerGeo.translate(0, 0, TRACER_LENGTH / 2);
    this.tracers = new THREE.InstancedMesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xfff2b0, transparent: true, opacity: 0.92, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    }), MAX_TRACERS);
    this.tracers.frustumCulled = false;
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tracers);

    // Police return fire gets its own red instanced tracers
    this.enemyTracers = new THREE.InstancedMesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xff4d6d, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    }), MAX_ENEMY_TRACERS);
    this.enemyTracers.frustumCulled = false;
    this.enemyTracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.enemyTracers);

    // Sparks reuse one point cloud instead of allocating a sprite per impact
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    for (let i = 0; i < MAX_SPARKS; i++) this.sparkPos[i * 3 + 1] = -1000;
    this.sparkVel = Array.from({ length: MAX_SPARKS }, () => new THREE.Vector3());
    this.sparkLife = new Float32Array(MAX_SPARKS);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      map: radialTexture([
        [0, 'rgba(255,255,230,1)'], [0.35, 'rgba(255,175,60,.9)'], [1, 'rgba(255,60,20,0)']
      ]),
      size: 11, sizeAttenuation: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);

    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture([
        [0, 'rgba(255,255,240,1)'], [0.3, 'rgba(255,205,90,.85)'], [1, 'rgba(255,90,20,0)']
      ]),
      transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    }));
    this.muzzle.visible = false;
    scene.add(this.muzzle);

    this.hideTracers();
  }

  needsReload() { return this.ammo < this.magSize && this.reloadTimer <= 0; }

  refill() {
    this.ammo = this.magSize;
    this.reloadTimer = 0;
    this.bullets.length = 0;
  }

  startReload(game) {
    if (!this.needsReload()) return false;
    this.reloadTimer = 1.05;
    game?.audio?.reload();
    game?.notify('RELOADING', 'gold');
    return true;
  }

  /** Fire one round from the camera aim, offset to the driver's side. */
  tryFire(game) {
    if (!game || game.paused || game.player.dead) return false;
    if (this.reloadTimer > 0 || this.cooldown > 0) return false;
    if (this.ammo <= 0) return this.startReload(game);

    this.ammo--;
    this.cooldown = 0.135;
    game.stats.shotsFired++;

    const dir = new THREE.Vector3();
    game.camera.getWorldDirection(dir);
    // Keep rounds near the street plane so crosshair shots connect with targets
    dir.y = THREE.MathUtils.clamp(dir.y, -0.24, 0.12);
    dir.x += (Math.random() - 0.5) * 0.014;
    dir.y += (Math.random() - 0.5) * 0.006;
    dir.z += (Math.random() - 0.5) * 0.014;
    dir.normalize();

    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const p = game.player;
    const origin = new THREE.Vector3();
    if (p.inVehicle && p.currentVehicle) {
      origin.set(p.currentVehicle.position.x, 19, p.currentVehicle.position.z)
        .addScaledVector(right, 21)
        .addScaledVector(dir, 27);
    } else {
      origin.set(p.position.x, 18, p.position.z)
        .addScaledVector(right, 8)
        .addScaledVector(dir, 12);
    }

    this.bullets.push({
      pos: origin.clone(),
      prev: origin.clone(),
      vel: dir.clone().multiplyScalar(BULLET_SPEED),
      life: 0.75
    });
    if (this.bullets.length > MAX_TRACERS) this.bullets.shift();

    this.muzzle.position.copy(origin).addScaledVector(dir, 4);
    this.muzzle.scale.setScalar(p.inVehicle ? 17 : 13);
    this.muzzle.material.opacity = 1;
    this.muzzle.visible = true;
    this.muzzleLife = 0.07;

    game.audio?.shoot();
    // Gunfire alone draws heat; repeated shots do not stack instantly
    if (game.wanted === 0 && this.heatCooldown <= 0) {
      game.addWanted(1);
      game.notify('SHOTS FIRED  —  WANTED 1', 'pink');
      this.heatCooldown = 6;
    }
    return true;
  }

  /** A single warning shot from a police cruiser toward the player. */
  policeShot(game, car) {
    if (!game || game.player.dead) return false;
    const from = car.position.clone();
    from.y = 18;
    const to = game.player.position.clone();
    to.y = 18;
    const scatter = 12 + Math.abs(game.player.speed) * 0.18;
    to.x += (Math.random() - 0.5) * scatter * 2;
    to.z += (Math.random() - 0.5) * scatter * 2;
    this.enemyShots.push({ prev: from, pos: to, life: 0.14 });
    if (this.enemyShots.length > MAX_ENEMY_TRACERS) this.enemyShots.shift();

    const chance = Math.min(0.72, 0.24 + game.wanted * 0.09);
    const hit = Math.random() < chance;
    if (hit) {
      game.player.damage(5 + game.wanted * 2);
      game.flashHit();
      game.shake = Math.min(2.6, game.shake + 0.7);
      if (game.policeHitCooldown <= 0) {
        game.notify('HIT BY POLICE', 'pink');
        game.policeHitCooldown = 1.6;
      }
    }
    game.audio?.enemyShot();
    return hit;
  }

  /** Segment-to-point distance in the ground plane, with the closest t value. */
  segmentPoint(ax, az, bx, bz, px, pz) {
    const dx = bx - ax, dz = bz - az;
    const len = dx * dx + dz * dz;
    const t = len > 0.0001
      ? THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / len, 0, 1) : 0;
    return {
      t,
      d: Math.hypot(ax + dx * t - px, az + dz * t - pz)
    };
  }

  findImpact(b, game) {
    const ax = b.prev.x, az = b.prev.z, bx = b.pos.x, bz = b.pos.z;
    const y = b.pos.y;
    let best = null;
    let bestT = Infinity;

    if (y > 2 && y < 32) {
      game.pedestrians.forEach(p => {
        if (!p.alive) return;
        const hit = this.segmentPoint(ax, az, bx, bz, p.mesh.position.x, p.mesh.position.z);
        if (hit.d < 9 && hit.t < bestT) {
          bestT = hit.t;
          best = { type: 'ped', obj: p, t: hit.t };
        }
      });
      game.vehicles.forEach(v => {
        if (v.userData.wrecked || v === game.player.currentVehicle) return;
        const hit = this.segmentPoint(ax, az, bx, bz, v.position.x, v.position.z);
        if (hit.d < 30 && hit.t < bestT) {
          bestT = hit.t;
          best = { type: 'car', obj: v, t: hit.t };
        }
      });
    }

    // Buildings stop bullets, but only if the wall is closer than a target
    let blockT = Infinity;
    for (let s = 1; s <= 3; s++) {
      const t = s / 3;
      if (game.city.isBlocked(ax + (bx - ax) * t, az + (bz - az) * t, 2)) {
        blockT = t;
        break;
      }
    }
    if (blockT < bestT) {
      best = { type: 'wall', t: blockT };
      bestT = blockT;
    }
    if (!best) return null;

    const point = new THREE.Vector3(
      THREE.MathUtils.lerp(ax, bx, best.t),
      y,
      THREE.MathUtils.lerp(az, bz, best.t)
    );
    game.stats.shotsHit++;

    if (best.type === 'ped') {
      const p = best.obj;
      p.alive = false;
      p.knocked = 6;
      p.mesh.rotation.z = Math.PI / 2;
      p.mesh.position.y = Math.max(-4, p.mesh.position.y - 1);
      game.addWanted(1);
      game.notify('PEDESTRIAN SHOT', 'pink');
      game.audio?.hit();
    } else if (best.type === 'car') {
      const v = best.obj;
      const u = v.userData;
      u.damage = Math.min(1, (u.damage || 0) + 0.09);
      u.paint?.color.offsetHSL(0, 0, -0.015);
      const m = game.mission;
      if (m.active && m.type === 'sweep' && v === m.targetVehicle) {
        m.targetHP -= 12;
        if (m.targetHP <= 0) game.completeMission('TARGET WRECKED');
        else game.notify(`TARGET DAMAGE  ${Math.max(0, Math.ceil(m.targetHP))}%`, 'pink');
      }
      game.audio?.impact();
    }
    game.checkAchievements();
    return point;
  }

  spawnSpark(pos, hot = false) {
    let slot = this.sparkLife.indexOf(Math.min(...this.sparkLife));
    if (this.sparkLife[slot] > 0 && !this.sparkLife.includes(0)) {
      slot = (this._sparkCursor = ((this._sparkCursor || 0) + 1) % MAX_SPARKS);
    }
    this.sparkPos[slot * 3] = pos.x;
    this.sparkPos[slot * 3 + 1] = Math.max(2, pos.y);
    this.sparkPos[slot * 3 + 2] = pos.z;
    this.sparkVel[slot].set(
      (Math.random() - 0.5) * 34,
      8 + Math.random() * 24,
      (Math.random() - 0.5) * 34
    );
    this.sparkLife[slot] = hot ? 0.42 : 0.3;
  }

  update(dt, game) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.heatCooldown = Math.max(0, this.heatCooldown - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        this.ammo = this.magSize;
        game?.notify('RELOADED', 'green');
      }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      const impact = this.findImpact(b, game);
      if (impact || b.life <= 0 || b.pos.y < 2) {
        this.spawnSpark(impact || b.pos, !!impact);
        this.bullets.splice(i, 1);
      }
    }

    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      this.enemyShots[i].life -= dt;
      if (this.enemyShots[i].life <= 0) this.enemyShots.splice(i, 1);
    }

    if (this.muzzleLife > 0) {
      this.muzzleLife -= dt;
      this.muzzle.material.opacity = Math.max(0, this.muzzleLife / 0.07);
      if (this.muzzleLife <= 0) this.muzzle.visible = false;
    }
    this.syncTracers();
    this.syncSparks(dt);
  }

  hideTracers() {
    this.dummy.position.set(0, -1000, 0);
    this.dummy.quaternion.identity();
    this.dummy.scale.set(1, 1, 0.0001);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.setMatrixAt(i, this.dummy.matrix);
    for (let i = 0; i < MAX_ENEMY_TRACERS; i++) this.enemyTracers.setMatrixAt(i, this.dummy.matrix);
    this.tracers.instanceMatrix.needsUpdate = true;
    this.enemyTracers.instanceMatrix.needsUpdate = true;
  }

  writeTracers(mesh, max, shots) {
    let i = 0;
    for (const b of shots) {
      if (i >= max) break;
      const delta = this.tmp.subVectors(b.pos, b.prev);
      const dist = delta.length();
      if (dist < 0.05) continue;
      this.dummy.position.copy(b.prev);
      this.dummy.quaternion.setFromUnitVectors(this.axis, delta.normalize());
      this.dummy.scale.set(1, 1, dist / TRACER_LENGTH);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i++, this.dummy.matrix);
    }
    this.dummy.position.set(0, -1000, 0);
    this.dummy.scale.set(1, 1, 0.0001);
    this.dummy.updateMatrix();
    for (; i < max; i++) mesh.setMatrixAt(i, this.dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  syncTracers() {
    this.writeTracers(this.tracers, MAX_TRACERS, this.bullets);
    this.writeTracers(this.enemyTracers, MAX_ENEMY_TRACERS, this.enemyShots);
  }

  syncSparks(dt) {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      const v = this.sparkVel[i];
      this.sparkPos[i * 3] += v.x * dt;
      this.sparkPos[i * 3 + 1] += v.y * dt;
      this.sparkPos[i * 3 + 2] += v.z * dt;
      v.y -= 80 * dt;
      if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -1000;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }
}
