import * as THREE from 'three';

const VICE_PALETTE = [
  0xf2a0b8, 0xf7c9a0, 0xa8d8d8, 0xc9b6e8,
  0xf4dcc2, 0x9fc5d8, 0xf0b7c4, 0xd8c3a5,
  0xb8c8dd, 0xe8b0a0
];

export class City {
  constructor() {
    this.buildings = [];
    this.roads = [];
    this.colliders = []; // AABBs for collision: {minX,maxX,minZ,maxZ}

    const blockSize = 200;
    const roadWidth = 40;
    const buildingCount = 10;

    for (let i = -buildingCount; i <= buildingCount; i++) {
      for (let j = -buildingCount; j <= buildingCount; j++) {
        this.roads.push({
          type: 'roadA',
          x: i * blockSize - roadWidth / 2,
          z: j * blockSize - blockSize / 2,
          width: roadWidth,
          height: blockSize
        });
        this.roads.push({
          type: 'roadB',
          x: i * blockSize - blockSize / 2,
          z: j * blockSize - roadWidth / 2,
          width: blockSize,
          height: roadWidth
        });

        if (Math.random() > 0.22) {
          const w = blockSize - roadWidth - 16;
          const d = blockSize - roadWidth - 16;
          // Downtown (near center) gets taller buildings
          const dist = Math.hypot(i, j);
          const maxFloors = dist < 4 ? 16 : dist < 7 ? 9 : 5;
          const floors = 2 + Math.floor(Math.random() * maxFloors);
          // Buildings sit in the middle of each block; roads run along the
          // grid lines at multiples of `blockSize`.
          const b = {
            x: i * blockSize + blockSize / 2 - w / 2,
            z: j * blockSize + blockSize / 2 - d / 2,
            width: w, depth: d, floors,
            color: VICE_PALETTE[(Math.random() * VICE_PALETTE.length) | 0],
            style: Math.random()
          };
          this.buildings.push(b);
          this.colliders.push({
            minX: b.x, maxX: b.x + w,
            minZ: b.z, maxZ: b.z + d
          });
        }
      }
    }
  }

  build3D(scene) {
    this.group = new THREE.Group();
    const dummy = new THREE.Object3D();

    // ---- Asphalt ----
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 1 });
    const roadMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), asphalt, this.roads.length);
    this.roads.forEach((r, i) => {
      dummy.position.set(r.x + r.width / 2, 0.02, r.z + r.height / 2);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(r.width, r.height, 1);
      dummy.updateMatrix();
      roadMesh.setMatrixAt(i, dummy.matrix);
    });
    roadMesh.instanceMatrix.needsUpdate = true;
    roadMesh.receiveShadow = true;
    roadMesh.frustumCulled = false;
    this.group.add(roadMesh);

    // ---- Sidewalks (thin raised slabs around each block) ----
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, roughness: 0.95 });
    const walkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), walkMat, this.buildings.length);
    this.buildings.forEach((b, i) => {
      const pad = 8;
      dummy.position.set(b.x + b.width / 2, 1.2, b.z + b.depth / 2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.width + pad * 2, 2.4, b.depth + pad * 2);
      dummy.updateMatrix();
      walkMesh.setMatrixAt(i, dummy.matrix);
    });
    walkMesh.instanceMatrix.needsUpdate = true;
    walkMesh.receiveShadow = true;
    walkMesh.frustumCulled = false;
    this.group.add(walkMesh);

    // ---- Lane dashes ----
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffd76b, emissive: 0x554400, emissiveIntensity: 0.3 });
    const dashes = [];
    for (let i = -10; i <= 10; i++) {
      for (let k = -10; k <= 10; k++) {
        for (let t = -2; t <= 2; t++) {
          dashes.push({ x: i * 200, z: k * 200 + t * 40, w: 12, d: 2, rot: 0 });
          dashes.push({ x: i * 200 + t * 40, z: k * 200, w: 2, d: 12, rot: 0 });
        }
      }
    }
    const dashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dashMat, dashes.length);
    dashes.forEach((d, i) => {
      dummy.position.set(d.x, 0.06, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(d.w, d.d, 1);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(i, dummy.matrix);
    });
    dashMesh.instanceMatrix.needsUpdate = true;
    dashMesh.frustumCulled = false;
    this.group.add(dashMesh);

    // ---- Buildings ----
    const buildingMat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.15 });
    const buildingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMat, this.buildings.length);
    this.buildings.forEach((b, i) => {
      const h = b.floors * 11;
      dummy.position.set(b.x + b.width / 2, h / 2 + 2.4, b.z + b.depth / 2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.width, h, b.depth);
      dummy.updateMatrix();
      buildingMesh.setMatrixAt(i, dummy.matrix);
      buildingMesh.setColorAt(i, new THREE.Color(b.color));
    });
    buildingMesh.instanceMatrix.needsUpdate = true;
    if (buildingMesh.instanceColor) buildingMesh.instanceColor.needsUpdate = true;
    buildingMesh.castShadow = true;
    buildingMesh.receiveShadow = true;
    buildingMesh.frustumCulled = false;
    this.group.add(buildingMesh);

    // ---- Rooftop caps (art-deco detail) ----
    const capMat = new THREE.MeshStandardMaterial({ color: 0xe6e9f0, roughness: 0.6 });
    const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), capMat, this.buildings.length);
    this.buildings.forEach((b, i) => {
      const h = b.floors * 11;
      dummy.position.set(b.x + b.width / 2, h + 4, b.z + b.depth / 2);
      dummy.scale.set(b.width * 0.6, 3, b.depth * 0.6);
      dummy.updateMatrix();
      capMesh.setMatrixAt(i, dummy.matrix);
    });
    capMesh.instanceMatrix.needsUpdate = true;
    capMesh.castShadow = true;
    capMesh.frustumCulled = false;
    this.group.add(capMesh);

    // ---- Windows (two facades, warm/cool mix) ----
    const winGeo = new THREE.BoxGeometry(6, 6, 0.6);
    const winWarm = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc86b, emissiveIntensity: 0.9 });
    const winCool = new THREE.MeshStandardMaterial({ color: 0xa9e8ff, emissive: 0x4fb8ff, emissiveIntensity: 0.7 });
    const winWarmList = [], winCoolList = [];
    this.buildings.forEach(b => {
      const h = b.floors * 11;
      const cols = Math.max(2, Math.floor(b.width / 24));
      for (let fy = 0; fy < b.floors; fy++) {
        for (let fx = 0; fx < cols; fx++) {
          if (Math.random() > 0.35) {
            const list = Math.random() > 0.55 ? winWarmList : winCoolList;
            const x = b.x + 16 + fx * 24;
            const y = 9 + fy * 11;
            list.push({ x, y, z: b.z + b.depth + 0.5 });
            if (Math.random() > 0.6) list.push({ x, y, z: b.z - 0.5 });
          }
        }
      }
    });
    [ [winWarmList, winWarm], [winCoolList, winCool] ].forEach(([list, mat]) => {
      const m = new THREE.InstancedMesh(winGeo, mat, list.length);
      list.forEach((w, i) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      this.group.add(m);
    });

    // ---- Palm trees (Vice City signature) ----
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.9, side: THREE.DoubleSide });
    const palms = [];
    for (let i = -9; i <= 9; i++) {
      for (let j = -9; j <= 9; j++) {
        if ((i + j) % 2 === 0 && Math.random() > 0.45) {
          palms.push({ x: i * 200 + 20, z: j * 200 + 20, h: 18 + Math.random() * 12 });
        }
      }
    }
    const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.6, 1, 7), trunkMat, palms.length);
    const leafMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), leafMat, palms.length * 5);
    let li = 0;
    palms.forEach((p, i) => {
      dummy.position.set(p.x, p.h / 2, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, p.h, 1);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        dummy.position.set(p.x + Math.cos(a) * 6, p.h + 2, p.z + Math.sin(a) * 6);
        dummy.rotation.set(Math.PI / 2.6, a, 0);
        dummy.scale.set(3.5, 12, 1.2);
        dummy.updateMatrix();
        leafMesh.setMatrixAt(li++, dummy.matrix);
      }
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.castShadow = true;
    trunkMesh.frustumCulled = false;
    leafMesh.instanceMatrix.needsUpdate = true;
    leafMesh.frustumCulled = false;
    this.group.add(trunkMesh, leafMesh);

    // ---- Streetlights ----
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd070, emissiveIntensity: 1.6 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4050, metalness: 0.6, roughness: 0.5 });
    const lights = [];
    for (let i = -9; i <= 9; i += 2) {
      for (let j = -9; j <= 9; j++) {
        lights.push({ x: i * 200 + 20, z: j * 200 - 20 });
      }
    }
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.9, 1, 6), poleMat, lights.length);
    const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 8, 8), bulbMat, lights.length);
    lights.forEach((l, i) => {
      dummy.position.set(l.x, 9, l.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 18, 1);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.x, 18.5, l.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bulbMesh.setMatrixAt(i, dummy.matrix);
    });
    poleMesh.instanceMatrix.needsUpdate = true;
    bulbMesh.instanceMatrix.needsUpdate = true;
    poleMesh.frustumCulled = false;
    bulbMesh.frustumCulled = false;
    this.group.add(poleMesh, bulbMesh);

    scene.add(this.group);
    return this.group;
  }

  // Circle vs AABB resolution used by the collision system
  resolveCircle(x, z, radius) {
    let hit = false;
    let nx = 0, nz = 0;
    for (const c of this.colliders) {
      if (x + radius < c.minX || x - radius > c.maxX || z + radius < c.minZ || z - radius > c.maxZ) continue;
      const closestX = Math.max(c.minX, Math.min(x, c.maxX));
      const closestZ = Math.max(c.minZ, Math.min(z, c.maxZ));
      let dx = x - closestX, dz = z - closestZ;
      let d = Math.hypot(dx, dz);
      if (d < radius) {
        hit = true;
        if (d < 0.0001) {
          // center inside box — push out via nearest face
          const left = x - c.minX, right = c.maxX - x;
          const back = z - c.minZ, front = c.maxZ - z;
          const m = Math.min(left, right, back, front);
          if (m === left) { x = c.minX - radius; nx = -1; }
          else if (m === right) { x = c.maxX + radius; nx = 1; }
          else if (m === back) { z = c.minZ - radius; nz = -1; }
          else { z = c.maxZ + radius; nz = 1; }
        } else {
          const push = (radius - d) / d;
          x += dx * push; z += dz * push;
          nx += dx / d; nz += dz / d;
        }
      }
    }
    return { x, z, hit, nx, nz };
  }

  isBlocked(x, z, radius) {
    for (const c of this.colliders) {
      if (x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ) return true;
    }
    return false;
  }

  /**
   * Camera collision: returns how far we can travel along `dir` from `origin`
   * before hitting a building. Used to pull the third-person camera in when
   * a wall sits between the player and the ideal camera position.
   */
  cameraHit(origin, dir, maxDist) {
    let nearest = maxDist;
    const ray = new THREE.Ray(origin, dir);
    const box = new THREE.Box3();
    const hitPoint = new THREE.Vector3();
    const maxHeight = 210;

    for (const c of this.colliders) {
      // Cheap XZ reject using the collider's full bounds, not its centre
      const rx = origin.x + dir.x * maxDist;
      const rz = origin.z + dir.z * maxDist;
      const loX = Math.min(origin.x, rx) - 10, hiX = Math.max(origin.x, rx) + 10;
      const loZ = Math.min(origin.z, rz) - 10, hiZ = Math.max(origin.z, rz) + 10;
      if (c.maxX < loX || c.minX > hiX || c.maxZ < loZ || c.minZ > hiZ) continue;

      box.min.set(c.minX, 0, c.minZ);
      box.max.set(c.maxX, maxHeight, c.maxZ);
      if (ray.intersectBox(box, hitPoint)) {
        const d = hitPoint.distanceTo(origin);
        if (d > 1 && d < nearest) nearest = d;
      }
    }
    return nearest;
  }

  /** Find a clear road-lane spawn point near a preferred location.
   *  Returns { x, z, dir } where dir is the road's heading (0 = N/S). */
  roadSpawn(preferredX, preferredZ) {
    const tryPoint = (x, z, dir) => !this.isBlocked(x, z, 26) ? { x, z, dir } : null;
    if (preferredX !== undefined && preferredZ !== undefined) {
      const p = tryPoint(preferredX, preferredZ, 0);
      if (p) return p;
    }
    for (let attempt = 0; attempt < 300; attempt++) {
      const i = (Math.random() * 20 | 0) - 10;
      const j = (Math.random() * 20 | 0) - 10;
      const along = (Math.random() - 0.5) * 150;
      const lane = Math.random() > 0.5 ? 8 : -8;
      // Roads run along grid lines at multiples of blockSize (200)
      const p = Math.random() > 0.5
        ? tryPoint(i * 200 + lane, j * 200 + along, 0)
        : tryPoint(i * 200 + along, j * 200 + lane, Math.PI / 2);
      if (p) return p;
    }
    return { x: 0, z: 0, dir: 0 };
  }
}
