import * as THREE from 'three';
import { createPlayerCharacter, animatePlayer } from './models.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.position = new THREE.Vector3(0, 0, 0);
    this.health = 100;
    this.armor = 100;
    this.dead = false;
    this.speed = 0;
    this.maxSpeed = 78;
    this.acceleration = 90;
    this.turnSpeed = 2.5;
    this.friction = 1.15;
    this.rotation = 0;
    this.inVehicle = false;
    this.currentVehicle = null;
    this.game = null;
    this.radius = 7;
    this.collisionThisFrame = false;
    this.collisionSpeed = 0;

    // Hero character — fully articulated model
    this.character = createPlayerCharacter();
    this.character.position.copy(this.position);
    scene.add(this.character);

    // Soft contact shadow
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false
    });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(8, 24), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.08;
    scene.add(this.shadow);
  }

  setGame(g) { this.game = g; }

  tryEnterVehicle(vehicles) {
    let best = null, bestDist = 55;
    for (const v of vehicles) {
      const d = Math.hypot(this.position.x - v.position.x, this.position.z - v.position.z);
      if (d < bestDist) { bestDist = d; best = v; }
    }
    if (best) {
      this.inVehicle = true;
      this.currentVehicle = best;
      this.speed = best.userData.aiSpeed ?? 0; // don't freeze a moving AI car
      this.rotation = best.rotation.y;
      this.character.visible = false;
      this.shadow.visible = false;
      return true;
    }
    return false;
  }

  exitVehicle() {
    if (!this.inVehicle) return;
    const v = this.currentVehicle;
    // Step out beside the car, not into its rear bumper
    const side = new THREE.Vector3(Math.cos(v.rotation.y), 0, -Math.sin(v.rotation.y)).multiplyScalar(20);
    this.position.set(v.position.x + side.x, 0, v.position.z + side.z);
    const res = this.game.city.resolveCircle(this.position.x, this.position.z, this.radius);
    this.position.x = res.x; this.position.z = res.z;
    this.inVehicle = false;
    this.currentVehicle = null;
    this.character.visible = true;
    this.shadow.visible = true;
    this.speed = 0;
    this.rotation = v.rotation.y + Math.PI / 2;
  }

  damage(amount) {
    if (this.dead) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.7);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.dead = true;
  }

  repair() {
    this.health = 100;
    this.armor = 100;
    this.dead = false;
    if (this.currentVehicle) {
      this.currentVehicle.userData.paint?.color.setHex(0x44ff88);
      this.currentVehicle.userData.damage = 0;
      this.currentVehicle.userData.brake = false;
    }
  }

  update(dt, camYaw, keys) {
    if (this.dead) return;
    this.collisionThisFrame = false;
    this.collisionSpeed = 0;

    if (this.inVehicle && this.currentVehicle) {
      const v = this.currentVehicle;
      const throttle = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
      const steer = (keys['a'] || keys['arrowleft'] ? 1 : 0) - (keys['d'] || keys['arrowright'] ? 1 : 0);
      const handbrake = !!keys[' '];
      v.userData.brake = handbrake || (throttle !== 0 && throttle * this.speed < -1);

      // Engine + drag
      if (throttle !== 0) this.speed += throttle * this.acceleration * dt;
      this.speed -= this.speed * (handbrake ? 3.2 : this.friction) * dt;
      this.speed = THREE.MathUtils.clamp(this.speed, -24, this.maxSpeed);

      // Speed-sensitive steering: no tank-like rotation while parked
      const speedFactor = Math.min(1, Math.abs(this.speed) / 14);
      const steerRate = this.turnSpeed * speedFactor * (handbrake ? 1.5 : 1);
      if (Math.abs(this.speed) > 1) {
        v.rotation.y -= steer * steerRate * dt * (this.speed >= 0 ? 1 : -1);
      }

      // Body roll into corners
      if (v.userData.shell) {
        v.userData.shell.rotation.z = THREE.MathUtils.lerp(
          v.userData.shell.rotation.z, Math.abs(this.speed) > 1 ? -steer * speedFactor * 0.055 : 0,
          Math.min(1, dt * 6)
        );
      }

      const fx = Math.sin(v.rotation.y), fz = Math.cos(v.rotation.y);
      const nx = v.position.x + fx * this.speed * dt;
      const nz = v.position.z + fz * this.speed * dt;
      const res = this.game.city.resolveCircle(nx, nz, 14);

      if (res.hit && Math.abs(this.speed) > 8) {
        this.collisionThisFrame = true;
        this.collisionSpeed = Math.abs(this.speed);
        this.speed *= 0.22;
        this.damage(this.collisionSpeed * 0.45);
        v.userData.damage = Math.min(1, (v.userData.damage || 0) + this.collisionSpeed / 180);
        if (v.userData.paint) v.userData.paint.color.offsetHSL(0, 0, -0.02);
      }
      v.position.x = res.x;
      v.position.z = res.z;
      v.position.y = 15 + (res.hit ? 0 : Math.sin(performance.now() * 0.01) * 0.25);

      // Rolling wheels
      (v.userData.wheels || []).forEach(w => { w.rotation.z += this.speed * dt * 0.11; });

      this.position.copy(v.position);
      this.rotation = v.rotation.y;
      animatePlayer(this.character, this.speed, dt, true);
    } else {
      const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
      const move = new THREE.Vector3();
      if (keys['w'] || keys['arrowup']) move.add(forward);
      if (keys['s'] || keys['arrowdown']) move.sub(forward);
      if (keys['d'] || keys['arrowright']) move.add(right);
      if (keys['a'] || keys['arrowleft']) move.sub(right);

      const running = !!keys['shift'];
      const moveSpeed = running ? 54 : 32;
      let walked = 0;
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(moveSpeed * dt);
        const res = this.game.city.resolveCircle(this.position.x + move.x, this.position.z + move.z, this.radius);
        walked = Math.hypot(res.x - this.position.x, res.z - this.position.z);
        this.position.x = res.x;
        this.position.z = res.z;
        this.rotation = Math.atan2(move.x, move.z);
      }

      this.character.position.copy(this.position);
      this.character.rotation.y = this.rotation;
      this.shadow.position.set(this.position.x, 0.08, this.position.z);
      this.speed = walked / Math.max(dt, 0.001);
      animatePlayer(this.character, this.speed, dt, false);
    }

    // World bounds
    const B = 2300;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -B, B);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -B, B);
    if (this.currentVehicle) {
      this.currentVehicle.position.x = this.position.x;
      this.currentVehicle.position.z = this.position.z;
    }
  }
}
