import * as THREE from 'three';

const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.95 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.9, roughness: 0.25 });
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x142b3a, metalness: 0.6, roughness: 0.15,
  transparent: true, opacity: 0.82, side: THREE.DoubleSide
});
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ef, metalness: 1, roughness: 0.2 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 1.4 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2038, emissive: 0xff1020, emissiveIntensity: 1.2 });

/* ------------------------------------------------------------------ */
/*  Instanced traffic fleet — every car shares one mesh per body part.  */
/*  Proxies keep the existing driving/collision code unchanged.         */
/* ------------------------------------------------------------------ */

/** A lightweight transform + style proxy. The real geometry lives in CarFleet. */
export function createCarProxy(color) {
  const car = new THREE.Group();
  car.userData.paint = { color: new THREE.Color(color) };
  car.userData.damage = 0;
  car.userData.brake = false;
  car.userData.shell = { rotation: { z: 0 } };
  // Eight simple objects so player.js can spin wheels without knowing about instancing.
  car.userData.wheels = Array.from({ length: 8 }, () => ({ rotation: { z: 0 } }));
  return car;
}

export class CarFleet {
  constructor(cars, scene) {
    this.cars = cars;
    this.local = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.shellMatrix = new THREE.Matrix4();
    this.shellEuler = new THREE.Euler(0, -Math.PI / 2, 0);
    this.sirenRed = new THREE.Color(0xff2038);
    this.sirenBlue = new THREE.Color(0x2b8fff);
    this.sirenOff = new THREE.Color(0x000000);
    this.tailOn = new THREE.Color(0xff3048);
    this.tailOff = new THREE.Color(0x65131c);
    this.tint = new THREE.Color();
    this.parts = [];

    const paintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16161c, roughness: 0.8 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1a1a20, metalness: 0.4, roughness: 0.5 });
    const creaseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 });

    // Coordinates below are in the original model space: +X = nose, Y up, Z across.
    const parts = [
      ['bodyLower', new THREE.BoxGeometry(86, 18.2, 26), [0, 3.9, 0], () => paintMat, null, true],
      ['bodyUpper', new THREE.BoxGeometry(82.56, 7.8, 24.96), [0, 16.12, 0], () => paintMat, null, true],
      ['skirtA', new THREE.BoxGeometry(77.4, 4.68, 2), [0, -5.72, -12], () => darkMat],
      ['skirtB', new THREE.BoxGeometry(77.4, 4.68, 2), [0, -5.72, 12], () => darkMat],
      ['hood', new THREE.BoxGeometry(34, 0.6, 22), [25, 14, 0], () => creaseMat],
      ['cabin', new THREE.BoxGeometry(46, 18, 22), [-6, 23, 0], () => glassMat],
      ['wind', new THREE.BoxGeometry(2, 17, 20), [17, 23, 0], () => glassMat, null, false, -0.5],
      ['pillarA', new THREE.BoxGeometry(3, 18, 3), [-6, 23, -10], () => pillarMat],
      ['pillarB', new THREE.BoxGeometry(3, 18, 3), [-6, 23, 10], () => pillarMat],
      ['wheelFL', new THREE.CylinderGeometry(10, 10, 7, 20), [-27, -6, -12], () => tireMat, 'wheel'],
      ['wheelFR', new THREE.CylinderGeometry(10, 10, 7, 20), [-27, -6, 12], () => tireMat, 'wheel'],
      ['wheelRL', new THREE.CylinderGeometry(10, 10, 7, 20), [27, -6, -12], () => tireMat, 'wheel'],
      ['wheelRR', new THREE.CylinderGeometry(10, 10, 7, 20), [27, -6, 12], () => tireMat, 'wheel'],
      ['rimFL', new THREE.CylinderGeometry(5.5, 5.5, 7.4, 10), [-27, -6, -12], () => rimMat, 'wheel'],
      ['rimFR', new THREE.CylinderGeometry(5.5, 5.5, 7.4, 10), [-27, -6, 12], () => rimMat, 'wheel'],
      ['rimRL', new THREE.CylinderGeometry(5.5, 5.5, 7.4, 10), [27, -6, -12], () => rimMat, 'wheel'],
      ['rimRR', new THREE.CylinderGeometry(5.5, 5.5, 7.4, 10), [27, -6, 12], () => rimMat, 'wheel'],
      ['headA', new THREE.BoxGeometry(2, 5, 7), [43, 4, -8], () => lightMat],
      ['headB', new THREE.BoxGeometry(2, 5, 7), [43, 4, 8], () => lightMat],
      ['tailA', new THREE.BoxGeometry(2, 4, 7), [-43, 4, -8], () => tailMat],
      ['tailB', new THREE.BoxGeometry(2, 4, 7), [-43, 4, 8], () => tailMat],
      ['grille', new THREE.BoxGeometry(2, 5, 16), [43, -3, 0], () => chromeMat],
      ['lightbarRed', new THREE.BoxGeometry(4, 4, 12), [-6, 34, -6], () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })],
      ['lightbarBlue', new THREE.BoxGeometry(4, 4, 12), [-6, 34, 6], () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })]
    ];

    parts.forEach(([key, geo, pos, makeMat, kind, paint, extraRotZ]) => {
      const mesh = new THREE.InstancedMesh(geo, makeMat(), cars.length);
      mesh.castShadow = key !== 'hood' && key !== 'rimFL' && key !== 'rimFR' && key !== 'rimRL' && key !== 'rimRR';
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.parts.push({ key, mesh, pos, kind, paint, extraRotZ });
    });

    // One point per car: damaged cars emit a soft exhaust puff, others sit below ground.
    const puffCv = document.createElement('canvas');
    puffCv.width = puffCv.height = 64;
    const pc = puffCv.getContext('2d');
    const grad = pc.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(215,218,225,0.85)');
    grad.addColorStop(0.45, 'rgba(150,155,165,0.35)');
    grad.addColorStop(1, 'rgba(120,125,135,0)');
    pc.fillStyle = grad; pc.fillRect(0, 0, 64, 64);
    const puffTex = new THREE.CanvasTexture(puffCv);
    this.smokePos = new Float32Array(cars.length * 3);
    for (let i = 0; i < cars.length; i++) this.smokePos[i * 3 + 1] = -1000;
    this.smokeGeo = new THREE.BufferGeometry();
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smoke = new THREE.Points(this.smokeGeo, new THREE.PointsMaterial({
      map: puffTex, color: 0xc8ced8, size: 24, sizeAttenuation: true,
      transparent: true, opacity: 0.42, depthWrite: false
    }));
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);

    this.sync();
  }

  /** Push proxy transforms, paint, body roll and wheel spin to the GPU. */
  sync() {
    const redOn = Math.floor(performance.now() / 140) % 2 === 0;
    const t = performance.now() / 1000;
    this.cars.forEach((car, i) => {
      car.updateMatrix();
      this.shellEuler.set(0, -Math.PI / 2, car.userData.shell.rotation.z);
      this.shellMatrix.makeRotationFromEuler(this.shellEuler);
      const spin = car.userData.wheels[0].rotation.z;
      const police = !!car.userData.police;
      const damage = car.userData.damage || 0;
      const brake = !!car.userData.brake;

      this.parts.forEach(part => {
        const siren = part.key.startsWith('lightbar');
        const tail = part.key.startsWith('tail');
        const on = siren && police && ((part.key === 'lightbarRed') === redOn);
        this.local.position.set(part.pos[0], part.pos[1], part.pos[2]);
        const rx = part.kind === 'wheel' ? Math.PI / 2 : 0;
        const rz = part.kind === 'wheel' ? spin : (part.extraRotZ || 0);
        this.local.rotation.set(rx, 0, rz);
        this.local.scale.setScalar(siren ? (on ? 1 : 0) : 1);
        this.local.updateMatrix();
        this.matrix.multiplyMatrices(car.matrix, this.shellMatrix);
        this.matrix.multiply(this.local.matrix);
        part.mesh.setMatrixAt(i, this.matrix);
        if (part.paint) {
          this.tint.copy(car.userData.paint.color).multiplyScalar(1 - damage * 0.42);
          part.mesh.setColorAt(i, this.tint);
        }
        if (siren) part.mesh.setColorAt(i, on
          ? (part.key === 'lightbarRed' ? this.sirenRed : this.sirenBlue)
          : this.sirenOff);
        if (tail) part.mesh.setColorAt(i, brake ? this.tailOn : this.tailOff);
      });

      // Damaged engines trail smoke from the rear of the shell.
      this.local.position.set(-44, 4, 0);
      this.local.rotation.set(0, 0, 0);
      this.local.scale.setScalar(1);
      this.local.updateMatrix();
      this.matrix.multiplyMatrices(car.matrix, this.shellMatrix).multiply(this.local.matrix);
      if (damage > 0.25) {
        this.smokePos[i * 3] = this.matrix.elements[12] + Math.sin(t * 3 + i) * 3;
        this.smokePos[i * 3 + 1] = this.matrix.elements[13] + 5 + ((t * 18 + i * 7) % 26);
        this.smokePos[i * 3 + 2] = this.matrix.elements[14] + Math.cos(t * 2 + i) * 3;
      } else {
        this.smokePos[i * 3 + 1] = -1000;
      }
    });
    this.parts.forEach(part => {
      part.mesh.instanceMatrix.needsUpdate = true;
      if ((part.paint || part.key.startsWith('lightbar') || part.key.startsWith('tail')) && part.mesh.instanceColor) {
        part.mesh.instanceColor.needsUpdate = true;
      }
    });
    this.smokeGeo.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/*  Detailed player character                                          */
/* ------------------------------------------------------------------ */

const P = {
  skin:    new THREE.MeshStandardMaterial({ color: 0xdfae8e, roughness: 0.72 }),
  hair:    new THREE.MeshStandardMaterial({ color: 0x17121c, roughness: 0.9 }),
  jacket:  new THREE.MeshStandardMaterial({ color: 0x14213d, roughness: 0.72, metalness: 0.08 }),
  shirt:   new THREE.MeshStandardMaterial({ color: 0xf5f3ef, roughness: 0.88 }),
  pants:   new THREE.MeshStandardMaterial({ color: 0x222b3d, roughness: 0.9 }),
  shoe:    new THREE.MeshStandardMaterial({ color: 0x0e1119, roughness: 0.75 }),
  accent:  new THREE.MeshStandardMaterial({ color: 0xff4f81, roughness: 0.5, metalness: 0.1 }),
  metal:   new THREE.MeshStandardMaterial({ color: 0xc8d2e0, metalness: 0.95, roughness: 0.22 }),
  eye:     new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.3 }),
  pupil:   new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.2 }),
  mouth:   new THREE.MeshStandardMaterial({ color: 0x8c4a52, roughness: 0.8 })
};

function mesh(geo, mat, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

/**
 * A fully articulated, stylised-realistic humanoid (~38 units tall).
 * Facing direction is +Z. All animation pivots are exposed in userData.
 */
export function createPlayerCharacter() {
  const root = new THREE.Group();

  // --- Hips ---
  const hips = mesh(new THREE.BoxGeometry(11, 6, 7.5), P.pants, 0, 14.5, 0, root);
  const belt = mesh(new THREE.BoxGeometry(11.4, 1.3, 7.9), P.shoe, 0, 17.4, 0, root);
  mesh(new THREE.BoxGeometry(2.4, 1.8, 0.8), P.metal, 0, 17.4, 4.2, root);

  // --- Torso pivot (lean / bob) ---
  const torsoPivot = new THREE.Group();
  torsoPivot.position.y = 18;
  root.add(torsoPivot);

  const chest = mesh(new THREE.CapsuleGeometry(5.4, 8, 5, 12), P.jacket, 0, 3.5, 0, torsoPivot);
  chest.scale.set(1, 1, 0.68);

  // White tee visible between open jacket panels
  const tee = mesh(new THREE.BoxGeometry(6.4, 11.5, 0.6), P.shirt, 0, 3.5, 3.75, torsoPivot);
  mesh(new THREE.BoxGeometry(5.4, 1.2, 0.7), P.accent, 0, 6.2, 4.1, torsoPivot);

  [-1, 1].forEach(s => {
    const lapel = mesh(new THREE.BoxGeometry(2.6, 9.5, 1.0), P.jacket, s * 2.5, 3.8, 4.05, torsoPivot);
    lapel.rotation.z = s * 0.17;
  });

  // Collar + neck
  const collar = mesh(new THREE.TorusGeometry(4.1, 0.9, 6, 16), P.accent, 0, 9.3, 0, torsoPivot);
  collar.rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(2.2, 2.7, 3.2, 10), P.skin, 0, 10.6, 0.2, torsoPivot);

  // --- Head pivot ---
  const headPivot = new THREE.Group();
  headPivot.position.y = 12.4;
  torsoPivot.add(headPivot);

  const head = mesh(new THREE.SphereGeometry(5.0, 18, 16), P.skin, 0, 0, 0, headPivot);
  head.scale.set(0.9, 1.12, 0.92);
  const jaw = mesh(new THREE.SphereGeometry(3.7, 14, 12), P.skin, 0, -3.1, 0.7, headPivot);
  jaw.scale.set(1, 0.68, 1);

  [-1, 1].forEach(s => {
    mesh(new THREE.SphereGeometry(1.25, 10, 8), P.skin, s * 4.5, -0.4, 0, headPivot);
    // eye + pupil + brow
    const eye = mesh(new THREE.SphereGeometry(1.05, 10, 8), P.eye, s * 1.95, 0.5, 4.2, headPivot);
    eye.scale.set(1, 0.62, 0.5);
    mesh(new THREE.SphereGeometry(0.48, 8, 8), P.pupil, s * 1.95, 0.5, 4.7, headPivot);
    const brow = mesh(new THREE.BoxGeometry(2.1, 0.5, 0.45), P.hair, s * 1.95, 1.95, 4.28, headPivot);
    brow.rotation.z = s * 0.1;
  });

  const nose = mesh(new THREE.ConeGeometry(0.85, 1.9, 7), P.skin, 0, -0.7, 4.55, headPivot);
  nose.rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(2.3, 0.35, 0.35), P.mouth, 0, -3.15, 4.0, headPivot);

  // Hair: cap + swept fringe
  const hairCap = mesh(
    new THREE.SphereGeometry(5.12, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    P.hair, 0, 0.5, 0, headPivot
  );
  hairCap.scale.z = 0.95;
  [-1, 0, 1].forEach((s, i) => {
    const fringe = mesh(new THREE.ConeGeometry(1.5, 4.2, 5), P.hair, s * 2.3, 3.5, 3.4, headPivot);
    fringe.rotation.x = 0.65;
    fringe.rotation.z = (i - 1) * 0.35;
  });

  // Sunglasses resting on the head
  [-1, 1].forEach(s => {
    const lens = mesh(new THREE.BoxGeometry(2.2, 1.0, 0.4), P.shoe, s * 1.95, 4.0, 4.0, headPivot);
    lens.rotation.x = -0.2;
  });

  // --- Arms ---
  const arms = [];
  [-1, 1].forEach(s => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 6.4, 9.2, 0);
    torsoPivot.add(shoulder);

    mesh(new THREE.CapsuleGeometry(2.1, 4.8, 4, 10), P.jacket, 0, -3.2, 0, shoulder);
    mesh(new THREE.SphereGeometry(2.15, 10, 8), P.jacket, 0, -0.3, 0, shoulder);

    const elbow = new THREE.Group();
    elbow.position.y = -6.4;
    shoulder.add(elbow);
    mesh(new THREE.CapsuleGeometry(1.55, 4.4, 4, 10), P.skin, 0, -2.8, 0, elbow);
    const hand = mesh(new THREE.SphereGeometry(1.7, 10, 8), P.skin, 0, -5.8, 0, elbow);
    hand.scale.set(0.9, 1.15, 0.7);

    if (s === -1) {
      mesh(new THREE.CylinderGeometry(1.75, 1.75, 1.0, 12), P.metal, 0, -0.6, 0, elbow);
    }

    arms.push({ shoulder, elbow });
  });

  // --- Legs ---
  const legs = [];
  [-1, 1].forEach(s => {
    const hip = new THREE.Group();
    hip.position.set(s * 2.9, 13.5, 0);
    root.add(hip);
    mesh(new THREE.CapsuleGeometry(2.5, 6.2, 4, 10), P.pants, 0, -4.2, 0, hip);

    const knee = new THREE.Group();
    knee.position.y = -8.4;
    hip.add(knee);
    mesh(new THREE.CapsuleGeometry(2.05, 5.4, 4, 10), P.pants, 0, -3.6, 0, knee);
    mesh(new THREE.BoxGeometry(3.4, 2.1, 6.2), P.shoe, 0, -7.0, 1.4, knee);
    mesh(new THREE.BoxGeometry(3.5, 0.5, 6.3), P.accent, 0, -7.9, 1.4, knee);

    legs.push({ hip, knee });
  });

  root.userData = { torsoPivot, headPivot, arms, legs, phase: 0, seated: 0 };
  return root;
}

/** Procedural walk / run animation with articulated limbs and body bob. */
export function animatePlayer(mesh, speed, dt, inVehicle = false) {
  const u = mesh.userData;
  if (!u.arms) return;

  // Ease into / out of a seated driving pose
  u.seated = THREE.MathUtils.lerp(u.seated, inVehicle ? 1 : 0, Math.min(1, dt * 8));

  if (u.seated > 0.01) {
    u.torsoPivot.rotation.x = u.seated * 0.42;
    u.torsoPivot.position.y = 18 - u.seated * 3;
    u.headPivot.rotation.x = -u.seated * 0.18;
    u.arms.forEach((a, i) => {
      a.shoulder.rotation.x = THREE.MathUtils.lerp(a.shoulder.rotation.x, -1.15, dt * 8);
      a.elbow.rotation.x = THREE.MathUtils.lerp(a.elbow.rotation.x, -0.65, dt * 8);
    });
    u.legs.forEach(l => {
      l.hip.rotation.x = THREE.MathUtils.lerp(l.hip.rotation.x, -1.25, dt * 8);
      l.knee.rotation.x = THREE.MathUtils.lerp(l.knee.rotation.x, 1.15, dt * 8);
    });
    if (u.seated > 0.98) return;
  }

  const intensity = Math.min(1, speed / 34);
  u.phase += dt * (5 + speed * 0.32);
  const swing = Math.sin(u.phase) * 0.75 * intensity;
  const bob = Math.abs(Math.sin(u.phase)) * 1.1 * intensity;

  u.arms[0].shoulder.rotation.x = swing;
  u.arms[1].shoulder.rotation.x = -swing;
  u.arms[0].elbow.rotation.x = -0.2 - Math.max(0, swing) * 0.7;
  u.arms[1].elbow.rotation.x = -0.2 - Math.max(0, -swing) * 0.7;

  u.legs[0].hip.rotation.x = -swing * 1.1;
  u.legs[1].hip.rotation.x = swing * 1.1;
  u.legs[0].knee.rotation.x = Math.max(0, swing) * 1.05;
  u.legs[1].knee.rotation.x = Math.max(0, -swing) * 1.05;

  u.torsoPivot.position.y = 18 + bob - u.seated * 3;
  u.torsoPivot.rotation.x = (1 - u.seated) * intensity * 0.12;
  u.torsoPivot.rotation.z = Math.sin(u.phase) * 0.035 * intensity;
  u.headPivot.rotation.x = -intensity * 0.05 + u.seated * -0.18;
  u.headPivot.rotation.y = Math.sin(u.phase * 0.5) * 0.06 * intensity;
}

/* ------------------------------------------------------------------ */
/*  Instanced background crowd — one draw call per body part, not per   */
/*  pedestrian. Proxies keep the old transform-based game logic intact. */
/* ------------------------------------------------------------------ */

const skinTones = [0xf0c8a0, 0xd9a070, 0xa96b47, 0x7a4a32, 0xffd9b8];
const shirtColors = [0xff4f81, 0x35c9ff, 0xffd23f, 0x8b5cf6, 0x34d399, 0xf97316, 0xf1f5f9];
const pantColors = [0x1e293b, 0x334155, 0x3f2d52, 0x2b3a4a];
const bagColors = [0xf97316, 0x34d399, 0xe2e8f0];

/** A transform proxy with style data, but no meshes of its own. */
export function createPedestrianProxy() {
  const g = new THREE.Group();
  g.userData = {
    skin: skinTones[(Math.random() * skinTones.length) | 0],
    shirt: shirtColors[(Math.random() * shirtColors.length) | 0],
    pants: pantColors[(Math.random() * pantColors.length) | 0],
    hair: Math.random() > 0.2 ? 0x1b1412 : 0x9a6a3a,
    shades: Math.random() > 0.55,
    bag: Math.random() > 0.6 ? bagColors[(Math.random() * bagColors.length) | 0] : 0,
    phase: Math.random() * Math.PI * 2,
    swing: 0
  };
  return g;
}

export class PedestrianCrowd {
  constructor(proxies, scene) {
    this.proxies = proxies;
    this.local = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.tint = new THREE.Color();
    this.panicColor = new THREE.Color(0xffe066);
    this.parts = [];

    const parts = [
      ['torso', new THREE.BoxGeometry(11, 16, 7), [0, 18, 0], p => p.userData.shirt],
      ['hips', new THREE.BoxGeometry(10, 5, 7), [0, 9, 0], p => p.userData.pants],
      ['head', new THREE.SphereGeometry(5.2, 14, 12), [0, 32, 0], p => p.userData.skin],
      ['hair', new THREE.SphereGeometry(5.35, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), [0, 32.5, 0], p => p.userData.hair],
      ['armL', new THREE.BoxGeometry(3.5, 14, 4), [-7, 18, 0], p => p.userData.shirt, p => p.userData.swing],
      ['armR', new THREE.BoxGeometry(3.5, 14, 4), [7, 18, 0], p => p.userData.shirt, p => -p.userData.swing],
      ['legL', new THREE.BoxGeometry(4.2, 13, 5), [-2.6, 4, 0], p => p.userData.pants, p => -p.userData.swing],
      ['legR', new THREE.BoxGeometry(4.2, 13, 5), [2.6, 4, 0], p => p.userData.pants, p => p.userData.swing],
      ['shades', new THREE.BoxGeometry(10, 1.5, 1), [0, 33, 4.6], () => 0x141820, null, p => p.userData.shades],
      ['bag', new THREE.BoxGeometry(6, 9, 3), [8, 14, 2.5], p => p.userData.bag, null, p => !!p.userData.bag]
    ];

    parts.forEach(([key, geo, pos, color, swing, visible]) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: key === 'shades' ? 0.35 : 0.85 });
      const mesh = new THREE.InstancedMesh(geo, mat, proxies.length);
      mesh.castShadow = key !== 'hair' && key !== 'shades';
      mesh.frustumCulled = false;
      proxies.forEach((p, i) => mesh.setColorAt(i, new THREE.Color(color(p))));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      this.parts.push({ key, mesh, pos, color, swing, visible });
    });
    this.sync();
  }

  /** Advance the walk cycle for one proxy. */
  animate(proxy, speed, dt) {
    const u = proxy.userData;
    u.phase += dt * (4 + speed * 0.6);
    u.swing = Math.sin(u.phase) * Math.min(0.6, speed * 0.08);
  }

  /** Push all proxy transforms (including knocked-down tilt) to the GPU. */
  sync() {
    this.proxies.forEach((proxy, i) => {
      proxy.updateMatrix();
      const panicking = (proxy.userData.panic || 0) > 0;
      this.parts.forEach(part => {
        const on = part.visible ? part.visible(proxy) : true;
        this.local.position.set(part.pos[0], part.pos[1], part.pos[2]);
        this.local.rotation.set(part.swing ? part.swing(proxy) : 0, 0, 0);
        this.local.scale.setScalar(on ? 1 : 0);
        this.local.updateMatrix();
        this.matrix.multiplyMatrices(proxy.matrix, this.local.matrix);
        part.mesh.setMatrixAt(i, this.matrix);
        if (part.key === 'torso' || part.key === 'armL' || part.key === 'armR') {
          this.tint.set(part.color(proxy)).lerp(this.panicColor, panicking ? 0.55 : 0);
          part.mesh.setColorAt(i, this.tint);
        }
      });
    });
    this.parts.forEach(part => {
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.key === 'torso' || part.key === 'armL' || part.key === 'armR') {
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      }
    });
  }
}
