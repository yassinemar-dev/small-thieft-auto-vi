import * as THREE from 'three';

const VICE_PALETTE = [
  0xf2a0b8, 0xf7c9a0, 0xa8d8d8, 0xc9b6e8,
  0xf4dcc2, 0x9fc5d8, 0xf0b7c4, 0xd8c3a5,
  0xb8c8dd, 0xe8b0a0
];

/** Small procedural canvas texture helper — keeps the city asset-free. */
function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function asphaltTexture() {
  return canvasTexture(256, (c, s) => {
    c.fillStyle = '#252b36';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 3200; i++) {
      const v = Math.random();
      c.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.015 + Math.random() * 0.035})`
                            : `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
      const x = Math.random() * s, y = Math.random() * s;
      c.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // Faint tar seams / cracks
    c.strokeStyle = 'rgba(10,12,18,0.35)';
    c.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      let x = Math.random() * s, y = Math.random() * s;
      c.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (Math.random() - 0.5) * 50;
        y += (Math.random() - 0.5) * 50;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  }, 2, 8);
}

function sidewalkTexture() {
  return canvasTexture(128, (c, s) => {
    c.fillStyle = '#9ba4ae';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(40,48,56,.07)';
      c.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    c.strokeStyle = 'rgba(58,68,78,.45)';
    c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * s;
      c.beginPath(); c.moveTo(p, 0); c.lineTo(p, s); c.stroke();
      c.beginPath(); c.moveTo(0, p); c.lineTo(s, p); c.stroke();
    }
  }, 5, 5);
}

export class City {
  /** Lane offset from a grid line. Both directions stay inside the road corridor. */
  static laneOffset(dir) {
    const d = ((dir % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (d < Math.PI / 4 || d >= Math.PI * 7 / 4) return -14; // +Z / -X
    if (d < Math.PI * 5 / 4) return -42;                     // +X / -Z
    return -14;                                              // -X
  }

  /** Walkers use the pavement strip on the building side of the grid line. */
  static sidewalkOffset() { return 14; }

  constructor() {
    this.buildings = [];
    this.roads = [];
    this.parks = [];
    this.colliders = []; // AABBs for collision: {minX,maxX,minZ,maxZ}
    this.glowMaterials = []; // emissive materials that brighten at night
    this.neonMaterials = []; // unlit sign materials that gain punch at night
    this.nightFactor = 0;

    const blockSize = 200;
    const roadWidth = 56; // wider avenues, less cramped than the first layout
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

        const dist = Math.hypot(i, j);
        // A few open lots break up the grid and give the city some breathing room
        if (dist > 2.5 && Math.random() < 0.055) {
          this.parks.push({ i, j });
        } else if (Math.random() > 0.22) {
          const w = blockSize - roadWidth - 16;
          const d = blockSize - roadWidth - 16;
          // Downtown (near center) gets taller buildings
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

    // ---- Asphalt (subtle grain + tar seams) ----
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 1 });
    this.asphaltMat = asphalt; // turns glassy and reflective after dark
    const roadMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), asphalt, this.roads.length);
    this.roads.forEach((r, i) => {
      dummy.position.set(r.x + r.width / 2, 0.12, r.z + r.height / 2);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(r.width, r.height, 1);
      dummy.updateMatrix();
      roadMesh.setMatrixAt(i, dummy.matrix);
    });
    roadMesh.instanceMatrix.needsUpdate = true;
    roadMesh.receiveShadow = true;
    roadMesh.frustumCulled = false;
    this.group.add(roadMesh);

    // ---- Solid road edge lines ----
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xe8e0c8, roughness: 1, transparent: true, opacity: 0.45
    });
    const edges = [];
    this.roads.forEach(r => {
      if (r.width < r.height) { // north/south road
        edges.push({ x: r.x + 2.5, z: r.z + r.height / 2, w: 1.6, d: r.height });
        edges.push({ x: r.x + r.width - 2.5, z: r.z + r.height / 2, w: 1.6, d: r.height });
      } else { // east/west road
        edges.push({ x: r.x + r.width / 2, z: r.z + 2.5, w: r.width, d: 1.6 });
        edges.push({ x: r.x + r.width / 2, z: r.z + r.height - 2.5, w: r.width, d: 1.6 });
      }
    });
    const edgeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), edgeMat, edges.length);
    edges.forEach((e, i) => {
      dummy.position.set(e.x, 0.32, e.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(e.w, e.d, 1);
      dummy.updateMatrix();
      edgeMesh.setMatrixAt(i, dummy.matrix);
    });
    edgeMesh.instanceMatrix.needsUpdate = true;
    edgeMesh.frustumCulled = false;
    this.group.add(edgeMesh);

    // ---- Sidewalks (thin raised slabs around each block) ----
    const walkMat = new THREE.MeshStandardMaterial({ map: sidewalkTexture(), roughness: 0.95 });
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

    // ---- Lane dashes (both directions now use the correct orientation) ----
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xffd76b, emissive: 0x554400, emissiveIntensity: 0.3
    });
    const dashes = [];
    for (let i = -10; i <= 10; i++) {
      for (let k = -10; k <= 10; k++) {
        for (let t = -2; t <= 2; t++) {
          dashes.push({ x: i * 200, z: k * 200 + t * 40, w: 12, d: 2 });
          dashes.push({ x: i * 200 + t * 40, z: k * 200, w: 12, d: 2 });
        }
      }
    }
    const dashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dashMat, dashes.length);
    dashes.forEach((d, i) => {
      dummy.position.set(d.x, 0.36, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(d.w, d.d, 1);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(i, dummy.matrix);
    });
    dashMesh.instanceMatrix.needsUpdate = true;
    dashMesh.frustumCulled = false;
    this.group.add(dashMesh);

    // ---- Directional lane arrows, one instanced mesh for the whole grid ----
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 9);
    arrowShape.lineTo(-7, -2);
    arrowShape.lineTo(-2.5, -2);
    arrowShape.lineTo(-2.5, -9);
    arrowShape.lineTo(2.5, -9);
    arrowShape.lineTo(2.5, -2);
    arrowShape.lineTo(7, -2);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(-Math.PI / 2); // shape's +Y now points towards -Z
    const arrows = [];
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        for (let t = -2; t <= 2; t++) {
          const along = t * 160;
          // N/S: -14 lane heads +Z, -42 heads -Z
          arrows.push({ x: i * 200 - 14, z: j * 200 + along, yaw: Math.PI });
          arrows.push({ x: i * 200 - 42, z: j * 200 + along, yaw: 0 });
          // E/W: -42 lane heads +X, -14 heads -X
          arrows.push({ x: i * 200 + along, z: j * 200 - 42, yaw: -Math.PI / 2 });
          arrows.push({ x: i * 200 + along, z: j * 200 - 14, yaw: Math.PI / 2 });
        }
      }
    }
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffe4a8, transparent: true, opacity: 0.38,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false
    });
    const arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, arrows.length);
    arrows.forEach((a, i) => {
      dummy.position.set(a.x, 0.42, a.z);
      dummy.rotation.set(0, a.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      arrowMesh.setMatrixAt(i, dummy.matrix);
    });
    arrowMesh.instanceMatrix.needsUpdate = true;
    arrowMesh.frustumCulled = false;
    this.group.add(arrowMesh);

    // ---- Zebra crossings at every intersection ----
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xf3eee0, roughness: 1, transparent: true, opacity: 0.72
    });
    const crossings = [];
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        for (let k = -2; k <= 2; k++) {
          crossings.push({ x: i * 200, z: j * 200 + k * 9, w: 42, d: 4.5 });
          crossings.push({ x: i * 200 + k * 9, z: j * 200, w: 4.5, d: 42 });
        }
      }
    }
    const crossMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), crossMat, crossings.length);
    crossings.forEach((c, i) => {
      dummy.position.set(c.x, 0.4, c.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(c.w, c.d, 1);
      dummy.updateMatrix();
      crossMesh.setMatrixAt(i, dummy.matrix);
    });
    crossMesh.instanceMatrix.needsUpdate = true;
    crossMesh.frustumCulled = false;
    this.group.add(crossMesh);

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

    // ---- Art-deco floor bands (one thin ledge per storey) ----
    const bands = [];
    this.buildings.forEach(b => {
      for (let f = 1; f <= b.floors; f++) {
        bands.push({
          x: b.x + b.width / 2,
          y: 2.4 + f * 11,
          z: b.z + b.depth / 2,
          w: b.width + 2.5,
          d: b.depth + 2.5
        });
      }
    });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.85 });
    const bandMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bandMat, bands.length);
    bands.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.w, 0.9, b.d);
      dummy.updateMatrix();
      bandMesh.setMatrixAt(i, dummy.matrix);
    });
    bandMesh.instanceMatrix.needsUpdate = true;
    bandMesh.castShadow = true;
    bandMesh.frustumCulled = false;
    this.group.add(bandMesh);

    // ---- Rooftop caps + AC units + a few water towers ----
    const h = b => b.floors * 11;
    const capMat = new THREE.MeshStandardMaterial({ color: 0xe6e9f0, roughness: 0.6 });
    const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), capMat, this.buildings.length);
    this.buildings.forEach((b, i) => {
      dummy.position.set(b.x + b.width / 2, h(b) + 4, b.z + b.depth / 2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.width * 0.6, 3, b.depth * 0.6);
      dummy.updateMatrix();
      capMesh.setMatrixAt(i, dummy.matrix);
    });
    capMesh.instanceMatrix.needsUpdate = true;
    capMesh.castShadow = true;
    capMesh.frustumCulled = false;
    this.group.add(capMesh);

    const acUnits = [], tanks = [];
    this.buildings.forEach(b => {
      const count = 1 + ((Math.random() * 3) | 0);
      for (let k = 0; k < count; k++) {
        acUnits.push({
          x: b.x + 18 + Math.random() * (b.width - 36),
          y: h(b) + 5.5,
          z: b.z + 18 + Math.random() * (b.depth - 36),
          s: 7 + Math.random() * 5
        });
      }
      if (b.floors > 4 && Math.random() > 0.55) {
        tanks.push({
          x: b.x + b.width * (0.3 + Math.random() * 0.4),
          y: h(b) + 12,
          z: b.z + b.depth * (0.3 + Math.random() * 0.4)
        });
      }
    });
    const acMat = new THREE.MeshStandardMaterial({ color: 0x8792a0, roughness: 0.8, metalness: 0.2 });
    const acMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), acMat, acUnits.length);
    acUnits.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(a.s, 5, a.s * 0.8);
      dummy.updateMatrix();
      acMesh.setMatrixAt(i, dummy.matrix);
    });
    acMesh.instanceMatrix.needsUpdate = true;
    acMesh.castShadow = true;
    acMesh.frustumCulled = false;
    this.group.add(acMesh);

    if (tanks.length) {
      const tankMat = new THREE.MeshStandardMaterial({ color: 0x8b5a4a, roughness: 0.9 });
      const tankMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), tankMat, tanks.length);
      tanks.forEach((t, i) => {
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(6, 12, 6);
        dummy.updateMatrix();
        tankMesh.setMatrixAt(i, dummy.matrix);
      });
      tankMesh.instanceMatrix.needsUpdate = true;
      tankMesh.castShadow = true;
      tankMesh.frustumCulled = false;
      this.group.add(tankMesh);
    }

    // ---- Windows on all four facades, warm/cool mix ----
    const winGeo = new THREE.BoxGeometry(6, 6, 0.6);
    const winWarm = new THREE.MeshStandardMaterial({
      color: 0xffe9a8, emissive: 0xffc86b, emissiveIntensity: 0.9
    });
    const winCool = new THREE.MeshStandardMaterial({
      color: 0xa9e8ff, emissive: 0x4fb8ff, emissiveIntensity: 0.7
    });
    this.glowMaterials.push({ mat: winWarm, base: 0.9, night: 1.9 });
    this.glowMaterials.push({ mat: winCool, base: 0.7, night: 1.6 });
    const winWarmList = [], winCoolList = [];
    this.buildings.forEach(b => {
      const bh = h(b);
      const cols = Math.max(2, Math.floor(b.width / 24));
      for (let fy = 0; fy < b.floors; fy++) {
        const y = 9 + fy * 11;
        for (let fx = 0; fx < cols; fx++) {
          if (Math.random() < 0.35) continue;
          const list = Math.random() > 0.55 ? winWarmList : winCoolList;
          const x = b.x + 16 + fx * 24;
          const z = b.z + 16 + fx * 24;
          // front / back
          list.push({ x, y, z: b.z + b.depth + 0.5, rot: 0 });
          if (Math.random() > 0.6) list.push({ x, y, z: b.z - 0.5, rot: 0 });
          // left / right (rotated boxes, more SA-style side detail)
          if (Math.random() > 0.45) list.push({ x: b.x - 0.5, y, z, rot: Math.PI / 2 });
          if (Math.random() > 0.45) list.push({ x: b.x + b.width + 0.5, y, z, rot: Math.PI / 2 });
        }
      }
    });
    [[winWarmList, winWarm], [winCoolList, winCool]].forEach(([list, mat]) => {
      const m = new THREE.InstancedMesh(winGeo, mat, list.length);
      list.forEach((w, i) => {
        dummy.position.set(w.x, w.y, w.z);
        dummy.rotation.set(0, w.rot, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      this.group.add(m);
    });

    // ---- Ground-floor shop awnings, neon signs and sidewalk bins ----
    const awningList = [], signList = [];
    const SHOP_COLORS = [0xff4f81, 0x35c9ff, 0xffd23f, 0x34d399, 0xf97316, 0xffe9d0];
    this.buildings.forEach(b => {
      const bays = Math.max(2, Math.floor(b.width / 34));
      for (let k = 0; k < bays; k++) {
        if (Math.random() > 0.38) continue;
        const x = bays === 1 ? b.x + b.width / 2 : b.x + 18 + k * (b.width - 36) / (bays - 1);
        awningList.push({
          x, y: 10.6, z: b.z + b.depth + 5.5, w: 22,
          color: SHOP_COLORS[(Math.random() * SHOP_COLORS.length) | 0]
        });
        signList.push({
          x, y: 16.5, z: b.z + b.depth + 0.9, w: 18,
          color: SHOP_COLORS[(Math.random() * SHOP_COLORS.length) | 0]
        });
      }
    });
    if (awningList.length) {
      const awningMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
      const awningMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), awningMat, awningList.length);
      awningList.forEach((a, i) => {
        dummy.position.set(a.x, a.y, a.z);
        dummy.rotation.set(-0.18, 0, 0);
        dummy.scale.set(a.w, 1.5, 12);
        dummy.updateMatrix();
        awningMesh.setMatrixAt(i, dummy.matrix);
        awningMesh.setColorAt(i, new THREE.Color(a.color));
      });
      awningMesh.instanceMatrix.needsUpdate = true;
      if (awningMesh.instanceColor) awningMesh.instanceColor.needsUpdate = true;
      awningMesh.castShadow = true;
      awningMesh.frustumCulled = false;
      this.group.add(awningMesh);
    }
    if (signList.length) {
      // Readable neon shop signs, one instanced mesh per word (6 draw calls)
      const words = ['MOTEL', 'VICE', '24H', 'BEACH', 'DINER', 'ARCADE'];
      const textures = words.map(word => {
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 64;
        const c = cv.getContext('2d');
        c.fillStyle = '#13131c'; c.fillRect(0, 0, 256, 64);
        c.strokeStyle = '#ff86b8'; c.lineWidth = 4; c.strokeRect(3, 3, 250, 58);
        c.font = 'bold 34px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.shadowColor = '#ff5ca8'; c.shadowBlur = 14;
        c.fillStyle = '#fff4e8'; c.fillText(word, 128, 33);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      });
      const groups = words.map(() => []);
      signList.forEach(s => groups[(Math.random() * words.length) | 0].push(s));
      groups.forEach((list, k) => {
        if (!list.length) return;
        const mat = new THREE.MeshBasicMaterial({
          map: textures[k], transparent: true, side: THREE.DoubleSide, toneMapped: false
        });
        this.neonMaterials.push(mat);
        const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length);
        list.forEach((s, i) => {
          dummy.position.set(s.x, s.y, s.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(s.w, 4.5, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
      });
    }
    // Wet-night neon smears on the street below every shop sign
    if (signList.length) {
      const smearTex = canvasTexture(128, (c, s) => {
        const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.3)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, s, s);
      });
      this.neonReflectionMat = new THREE.MeshBasicMaterial({
        map: smearTex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false
      });
      const smear = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1), this.neonReflectionMat, signList.length
      );
      signList.forEach((s, i) => {
        dummy.position.set(s.x, 0.4, s.z + 15);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(s.w * 1.5, 30, 1);
        dummy.updateMatrix();
        smear.setMatrixAt(i, dummy.matrix);
        smear.setColorAt(i, new THREE.Color(s.color));
      });
      smear.instanceMatrix.needsUpdate = true;
      if (smear.instanceColor) smear.instanceColor.needsUpdate = true;
      smear.frustumCulled = false;
      this.group.add(smear);
    }

    const bins = [];
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        if (Math.random() > 0.55) continue;
        bins.push({
          x: i * 200 + 30 + Math.random() * 8,
          z: j * 200 + 20 + Math.random() * 120,
          c: Math.random() > 0.5 ? 0x35424a : 0x8c3b46
        });
      }
    }
    if (bins.length) {
      const binMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const binMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 0.85, 1, 8), binMat, bins.length);
      bins.forEach((b, i) => {
        dummy.position.set(b.x, 3.6, b.z);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
        dummy.scale.set(3.2, 7.2, 3.2);
        dummy.updateMatrix();
        binMesh.setMatrixAt(i, dummy.matrix);
        binMesh.setColorAt(i, new THREE.Color(b.c));
      });
      binMesh.instanceMatrix.needsUpdate = true;
      if (binMesh.instanceColor) binMesh.instanceColor.needsUpdate = true;
      binMesh.castShadow = true;
      binMesh.frustumCulled = false;
      this.group.add(binMesh);
    }

    // ---- Palm trees + shrubs (Vice City signature greenery) ----
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x2e8b57, roughness: 0.9, side: THREE.DoubleSide
    });
    const palms = [], shrubs = [];
    for (let i = -9; i <= 9; i++) {
      for (let j = -9; j <= 9; j++) {
        if ((i + j) % 2 === 0 && Math.random() > 0.45) {
          const px = i * 200 + 20, pz = j * 200 + 20;
          palms.push({ x: px, z: pz, h: 18 + Math.random() * 12 });
          for (let k = 0; k < 3; k++) {
            const a = Math.random() * Math.PI * 2;
            shrubs.push({
              x: px + Math.cos(a) * (10 + Math.random() * 9),
              z: pz + Math.sin(a) * (10 + Math.random() * 9),
              s: 3 + Math.random() * 3
            });
          }
        }
      }
    }
    const trunkMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1.6, 1, 7), trunkMat, palms.length
    );
    const leafMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 5), leafMat, palms.length * 5
    );
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

    if (shrubs.length) {
      const shrubMat = new THREE.MeshStandardMaterial({
        color: 0x2f7d4f, roughness: 1, flatShading: true
      });
      const shrubMesh = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0), shrubMat, shrubs.length
      );
      shrubs.forEach((s, i) => {
        dummy.position.set(s.x, s.s * 0.7 + 2.4, s.z);
        dummy.rotation.set(Math.random(), Math.random(), Math.random());
        dummy.scale.set(s.s, s.s * 0.8, s.s);
        dummy.updateMatrix();
        shrubMesh.setMatrixAt(i, dummy.matrix);
      });
      shrubMesh.instanceMatrix.needsUpdate = true;
      shrubMesh.castShadow = true;
      shrubMesh.frustumCulled = false;
      this.group.add(shrubMesh);
    }

    // ---- Open park lots: shady trees and benches ----
    const parkTrees = [], benches = [];
    this.parks.forEach(p => {
      const cx = p.i * 200 + 100, cz = p.j * 200 + 100;
      const count = 4 + ((Math.random() * 4) | 0);
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 44;
        parkTrees.push({
          x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r,
          h: 16 + Math.random() * 10, s: 7 + Math.random() * 4
        });
      }
      for (let k = 0; k < 2; k++) {
        benches.push({
          x: cx + (Math.random() - 0.5) * 70,
          z: cz + (Math.random() - 0.5) * 70,
          rot: Math.random() * Math.PI
        });
      }
    });
    if (parkTrees.length) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c432d, roughness: 1 });
      const canopyMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
      const trunkMesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1.5, 1, 7), trunkMat, parkTrees.length
      );
      const canopyMesh = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1), canopyMat, parkTrees.length
      );
      parkTrees.forEach((t, i) => {
        dummy.position.set(t.x, t.h / 2 + 2.4, t.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, t.h, 1);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(t.x, t.h + 2.4 + t.s * 0.55, t.z);
        dummy.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.3);
        dummy.scale.set(t.s, t.s * 0.8, t.s);
        dummy.updateMatrix();
        canopyMesh.setMatrixAt(i, dummy.matrix);
        canopyMesh.setColorAt(i, new THREE.Color().setHSL(0.3 + Math.random() * 0.05, 0.42, 0.24 + Math.random() * 0.09));
      });
      trunkMesh.instanceMatrix.needsUpdate = true;
      canopyMesh.instanceMatrix.needsUpdate = true;
      if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
      trunkMesh.castShadow = true;
      canopyMesh.castShadow = true;
      trunkMesh.frustumCulled = false;
      canopyMesh.frustumCulled = false;
      this.group.add(trunkMesh, canopyMesh);
    }
    if (benches.length) {
      const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.9 });
      const benchMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), benchMat, benches.length);
      benches.forEach((b, i) => {
        dummy.position.set(b.x, 4.4, b.z);
        dummy.rotation.set(0, b.rot, 0);
        dummy.scale.set(13, 2.2, 4.5);
        dummy.updateMatrix();
        benchMesh.setMatrixAt(i, dummy.matrix);
      });
      benchMesh.instanceMatrix.needsUpdate = true;
      benchMesh.castShadow = true;
      benchMesh.frustumCulled = false;
      this.group.add(benchMesh);
    }

    // ---- Streetlights ----
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff0c0, emissive: 0xffd070, emissiveIntensity: 1.6
    });
    this.glowMaterials.push({ mat: bulbMat, base: 1.6, night: 3.2 });
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x3a4050, metalness: 0.6, roughness: 0.5
    });
    const lights = [];
    for (let i = -9; i <= 9; i += 2) {
      for (let j = -9; j <= 9; j++) {
        lights.push({ x: i * 200 + 20, z: j * 200 - 20 });
      }
    }
    const poleMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.7, 0.9, 1, 6), poleMat, lights.length
    );
    const bulbMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1.6, 8, 8), bulbMat, lights.length
    );
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

    // Warm halo + soft light pool — two draw calls for the whole city
    const glowTex = canvasTexture(64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,246,214,0.95)');
      g.addColorStop(0.35, 'rgba(255,208,140,0.35)');
      g.addColorStop(1, 'rgba(255,180,120,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    });
    const glowPos = new Float32Array(lights.length * 3);
    lights.forEach((l, i) => {
      glowPos[i * 3] = l.x; glowPos[i * 3 + 1] = 18.5; glowPos[i * 3 + 2] = l.z;
    });
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({
      map: glowTex, color: 0xffd9a0, size: 24, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    }));
    glow.frustumCulled = false;
    this.group.add(glow);

    const poolMat = new THREE.MeshBasicMaterial({
      color: 0xffb96b, transparent: true, opacity: 0.13,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false
    });
    const poolMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20), poolMat, lights.length);
    lights.forEach((l, i) => {
      dummy.position.set(l.x, 0.5, l.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(15, 15, 1);
      dummy.updateMatrix();
      poolMesh.setMatrixAt(i, dummy.matrix);
    });
    poolMesh.instanceMatrix.needsUpdate = true;
    poolMesh.frustumCulled = false;
    this.group.add(poolMesh);

    // Faint volumetric cones under each lamp — one instanced draw call
    this.lampShaftMat = new THREE.MeshBasicMaterial({
      color: 0xffd39a, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false
    });
    const shaftMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(15, 18, 12, 1, true), this.lampShaftMat, lights.length
    );
    lights.forEach((l, i) => {
      dummy.position.set(l.x, 9.5, l.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      shaftMesh.setMatrixAt(i, dummy.matrix);
    });
    shaftMesh.instanceMatrix.needsUpdate = true;
    shaftMesh.frustumCulled = false;
    this.group.add(shaftMesh);

    // ---- Distant State-of-San-Andreas-style hills on the horizon ----
    const hills = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.16;
      const r = 2650 + Math.random() * 500;
      const w = 320 + Math.random() * 420;
      const hh = 180 + Math.random() * 260;
      hills.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        w, hh, d: w * (0.7 + Math.random() * 0.6)
      });
    }
    const hillMat = new THREE.MeshStandardMaterial({
      color: 0x75637f, roughness: 1, flatShading: true
    });
    const hillMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1), hillMat, hills.length
    );
    hills.forEach((hill, i) => {
      dummy.position.set(hill.x, hill.hh * 0.28, hill.z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(hill.w, hill.hh, hill.d);
      dummy.updateMatrix();
      hillMesh.setMatrixAt(i, dummy.matrix);
      hillMesh.setColorAt(i, new THREE.Color().setHSL(0.78, 0.16, 0.32 + Math.random() * 0.1));
    });
    hillMesh.instanceMatrix.needsUpdate = true;
    if (hillMesh.instanceColor) hillMesh.instanceColor.needsUpdate = true;
    hillMesh.frustumCulled = false;
    this.group.add(hillMesh);

    // ---- Traffic lights at every intersection (red/green alternate, amber blinks) ----
    const intersections = [];
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        intersections.push({ x: i * 200 - 10, z: j * 200 - 10, phase: (i + j) & 1 });
      }
    }
    const signalPoleMat = new THREE.MeshStandardMaterial({ color: 0x303744, metalness: 0.6, roughness: 0.5 });
    const signalBoxMat = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.8 });
    const bulbMaterial = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const signalPoleMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.8, 1.1, 1, 6), signalPoleMat, intersections.length
    );
    const boxMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), signalBoxMat, intersections.length
    );
    const redMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.8, 8, 8), bulbMaterial(), intersections.length);
    const amberMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.8, 8, 8), bulbMaterial(), intersections.length);
    const greenMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.8, 8, 8), bulbMaterial(), intersections.length);
    intersections.forEach((s, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(s.x, 8.5, s.z);
      dummy.scale.set(1, 17, 1);
      dummy.updateMatrix(); signalPoleMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 17, s.z);
      dummy.scale.set(4, 11, 4);
      dummy.updateMatrix(); boxMesh.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(s.x, 20, s.z + 2.4);
      dummy.updateMatrix(); redMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 17, s.z + 2.4);
      dummy.updateMatrix(); amberMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, 14, s.z + 2.4);
      dummy.updateMatrix(); greenMesh.setMatrixAt(i, dummy.matrix);
    });
    [signalPoleMesh, boxMesh, redMesh, amberMesh, greenMesh].forEach(m => {
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
    });
    this.group.add(signalPoleMesh, boxMesh, redMesh, amberMesh, greenMesh);
    this.trafficLights = { red: redMesh, amber: amberMesh, green: greenMesh, entries: intersections };

    scene.add(this.group);
    return this.group;
  }

  /** Drive window/lamp/neon brightness from the shared day-night clock. */
  setNightFactor(f) {
    this.nightFactor = f;
    for (const g of this.glowMaterials) {
      g.mat.emissiveIntensity = THREE.MathUtils.lerp(g.base, g.night, f);
    }
    for (const mat of this.neonMaterials) {
      mat.color.setScalar(THREE.MathUtils.lerp(1, 1.25, f));
    }
    if (this.asphaltMat) {
      this.asphaltMat.roughness = THREE.MathUtils.lerp(1, 0.34, f);
      this.asphaltMat.metalness = THREE.MathUtils.lerp(0, 0.22, f);
    }
    if (this.neonReflectionMat) this.neonReflectionMat.opacity = THREE.MathUtils.lerp(0, 0.42, f);
    if (this.lampShaftMat) this.lampShaftMat.opacity = THREE.MathUtils.lerp(0, 0.11, f);
  }

  /** Alternate red/green every four seconds and blink the amber bulbs. */
  updateTrafficLights(time) {
    if (!this.trafficLights) return;
    const phase = Math.floor(time / 4) & 1;
    const blink = (time % 4) > 3.25;
    const c = new THREE.Color();
    this.trafficLights.entries.forEach((e, i) => {
      const go = (e.phase ^ phase) === 1;
      this.trafficLights.red.setColorAt(i, c.setHex(0xff3355).multiplyScalar(go ? 0.12 : 1));
      this.trafficLights.green.setColorAt(i, c.setHex(0x33ff88).multiplyScalar(go ? 1 : 0.12));
      this.trafficLights.amber.setColorAt(i, c.setHex(0xffb020).multiplyScalar(blink ? 1 : 0.08));
    });
    ['red', 'green', 'amber'].forEach(k => {
      const m = this.trafficLights[k];
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
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
    const tryPoint = (x, z, dir) => !this.isBlocked(x, z, 14) ? { x, z, dir } : null;
    if (preferredX !== undefined && preferredZ !== undefined) {
      const p = tryPoint(preferredX, preferredZ, 0);
      if (p) return p;
    }
    for (let attempt = 0; attempt < 300; attempt++) {
      const i = (Math.random() * 20 | 0) - 10;
      const j = (Math.random() * 20 | 0) - 10;
      const along = (Math.random() - 0.5) * 150;
      const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      const dir = dirs[(Math.random() * dirs.length) | 0];
      const lane = City.laneOffset(dir);
      // Roads run along grid lines at multiples of blockSize (200)
      const p = Math.abs(Math.sin(dir)) < 0.5
        ? tryPoint(i * 200 + lane, j * 200 + along, dir)
        : tryPoint(i * 200 + along, j * 200 + lane, dir);
      if (p) return p;
    }
    return { x: 0, z: 0, dir: 0 };
  }
}
