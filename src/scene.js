/**
 * The board in three dimensions.
 *
 * This module knows nothing about the rules: it receives positions and moves
 * that have already been validated, draws and animates them, and reports
 * upwards which square the user clicked. Every game decision lives elsewhere.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EMPTY, isKing, squareToRC } from './rules.js';

const COLORS = {
  dark: 0x1d2733,
  light: 0xd9cbb4,
  frame: 0x3a2a1c,
  frameEdge: 0x241a11,
  human: 0xe8ddc8,
  jev: 0x113f42,
  jevGlow: 0x0c2f33,
  gold: 0xc9a227,
  selection: 0xe8a33d,
  target: 0x3fd0c9,
  trail: 0x2a6b74,
};

const RADIUS = 0.37;
const MAN_HEIGHT = 0.17;
const KING_DISC_HEIGHT = 0.14;

/** A square's centre in world space: x grows to the right, z towards the viewer. */
function squareCentre(square) {
  const [row, col] = squareToRC(square);
  return new THREE.Vector3(col - 4.5, 0, row - 4.5);
}

function discProfile(radius, height) {
  const bevel = 0.045;
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(radius - bevel, 0),
    new THREE.Vector2(radius, bevel),
    new THREE.Vector2(radius, height - bevel),
    new THREE.Vector2(radius - bevel, height),
    new THREE.Vector2(0, height),
  ];
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The square numbers, drawn once onto a single texture. */
function numbersTexture() {
  const side = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d');
  const step = side / 10;

  ctx.font = `600 ${Math.round(step * 0.24)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(160, 182, 205, 0.42)';

  for (let square = 1; square <= 50; square++) {
    const [row, col] = squareToRC(square);
    ctx.fillText(String(square), (col + 0.5) * step, (row + 0.5) * step + step * 0.29);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createScene(container, { onPick } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const CAMERA_DIRECTION = new THREE.Vector3(0, 11.5, 11).normalize();
  const FRAMING_RADIUS = 7.9; // half the board plus a margin for the frame
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 9;
  controls.maxDistance = 34;
  controls.maxPolarAngle = Math.PI / 2.12; // never below the plane of the board
  controls.enablePan = false;

  // ---------- lighting ----------
  scene.add(new THREE.HemisphereLight(0x9fb4cc, 0x090b0f, 0.5));

  const keyLight = new THREE.DirectionalLight(0xfff2dc, 2.1);
  keyLight.position.set(6.5, 13, 7.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -9;
  keyLight.shadow.camera.right = 9;
  keyLight.shadow.camera.top = 9;
  keyLight.shadow.camera.bottom = -9;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 32;
  keyLight.shadow.bias = -0.0012;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x6f8fb5, 0.45);
  fillLight.position.set(-7, 6, -6);
  scene.add(fillLight);

  // ---------- frame ----------
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(11.6, 0.6, 11.6),
    new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.72, metalness: 0.05 }),
  );
  frame.position.y = -0.31;
  frame.receiveShadow = true;
  scene.add(frame);

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(12.2, 0.32, 12.2),
    new THREE.MeshStandardMaterial({ color: COLORS.frameEdge, roughness: 0.85 }),
  );
  plinth.position.y = -0.58;
  scene.add(plinth);

  // ---------- squares ----------
  const squareGeometry = new THREE.BoxGeometry(1, 0.06, 1);
  const lightMaterial = new THREE.MeshStandardMaterial({ color: COLORS.light, roughness: 0.62 });
  const squares = new Map(); // square number -> mesh (dark squares only, the playable ones)
  const squareGroup = new THREE.Group();

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const playable = (row + col) % 2 === 1;
      const material = playable
        ? new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.55 })
        : lightMaterial;
      const mesh = new THREE.Mesh(squareGeometry, material);
      mesh.position.set(col - 4.5, -0.03, row - 4.5);
      mesh.receiveShadow = true;
      if (playable) {
        mesh.userData.square = row * 5 + (row % 2 === 0 ? (col - 1) / 2 : col / 2) + 1;
        squares.set(mesh.userData.square, mesh);
      }
      squareGroup.add(mesh);
    }
  }
  scene.add(squareGroup);

  const numbers = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: numbersTexture(), transparent: true, depthWrite: false }),
  );
  numbers.position.y = 0.002;
  numbers.raycast = () => {}; // must not swallow clicks
  scene.add(numbers);

  // ---------- pieces ----------
  const manGeometry = new THREE.LatheGeometry(discProfile(RADIUS, MAN_HEIGHT), 48);
  const discGeometry = new THREE.LatheGeometry(discProfile(RADIUS, KING_DISC_HEIGHT), 48);
  const ringGeometry = new THREE.TorusGeometry(RADIUS - 0.01, 0.028, 10, 44).rotateX(Math.PI / 2);

  const materials = {
    human: new THREE.MeshStandardMaterial({ color: COLORS.human, roughness: 0.38, metalness: 0.06 }),
    jev: new THREE.MeshStandardMaterial({
      color: COLORS.jev, roughness: 0.32, metalness: 0.18,
      emissive: COLORS.jevGlow, emissiveIntensity: 0.9,
    }),
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.28, metalness: 0.85 }),
  };

  function createPiece(code) {
    const group = new THREE.Group();
    const material = code > 0 ? materials.human : materials.jev;

    if (isKing(code)) {
      for (const y of [0, KING_DISC_HEIGHT]) {
        const disc = new THREE.Mesh(discGeometry, material);
        disc.position.y = y;
        disc.castShadow = true;
        disc.receiveShadow = true;
        group.add(disc);
      }
      const ring = new THREE.Mesh(ringGeometry, materials.gold);
      ring.position.y = KING_DISC_HEIGHT;
      ring.castShadow = true;
      group.add(ring);
    } else {
      const disc = new THREE.Mesh(manGeometry, material);
      disc.castShadow = true;
      disc.receiveShadow = true;
      group.add(disc);
    }

    group.userData.code = code;
    return group;
  }

  const pieces = new Map(); // square number -> group
  const pieceGroup = new THREE.Group();
  scene.add(pieceGroup);

  function place(square, code) {
    const group = createPiece(code);
    group.position.copy(squareCentre(square));
    group.userData.square = square;
    for (const child of group.children) child.userData.square = square;
    pieceGroup.add(group);
    pieces.set(square, group);
    return group;
  }

  function clearPieces() {
    for (const group of pieces.values()) pieceGroup.remove(group);
    pieces.clear();
  }

  function syncBoard(state) {
    clearPieces();
    for (let square = 1; square <= 50; square++) {
      if (state.board[square] !== EMPTY) place(square, state.board[square]);
    }
  }

  // ---------- highlights ----------
  const targetRings = new THREE.Group();
  scene.add(targetRings);
  const targetGeometry = new THREE.RingGeometry(0.27, 0.35, 40).rotateX(-Math.PI / 2);
  const targetMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.target, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });

  let highlighted = { selected: null, targets: [], trail: [], hint: [] };

  function setHighlights(next = {}) {
    highlighted = { selected: null, targets: [], trail: [], hint: [], ...next };

    for (const [square, mesh] of squares) {
      const emissive = mesh.material.emissive;
      if (square === highlighted.selected) emissive.setHex(COLORS.selection).multiplyScalar(0.55);
      else if (highlighted.hint.includes(square)) emissive.setHex(COLORS.selection).multiplyScalar(0.4);
      else if (highlighted.targets.includes(square)) emissive.setHex(COLORS.target).multiplyScalar(0.3);
      else if (highlighted.trail.includes(square)) emissive.setHex(COLORS.trail).multiplyScalar(0.35);
      else emissive.setHex(0x000000);
    }

    targetRings.clear();
    for (const square of highlighted.targets) {
      const ring = new THREE.Mesh(targetGeometry, targetMaterial);
      ring.position.copy(squareCentre(square)).setY(0.012);
      targetRings.add(ring);
    }
  }
  setHighlights();

  // ---------- animation ----------
  function tween(duration, step) {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / duration);
        step(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function removePiece(square) {
    const group = pieces.get(square);
    if (!group) return;
    pieces.delete(square);
    await tween(230, (t) => {
      const e = easeInOut(t);
      group.position.y = -0.45 * e;
      group.scale.setScalar(Math.max(0.001, 1 - e));
    });
    pieceGroup.remove(group);
  }

  /**
   * Animates a move that has already been decided. Each hop of the chain is
   * travelled one at a time, and the captured piece disappears right after the
   * hop that jumped it, so you can see which piece fell to which jump.
   */
  async function playMove(move) {
    const group = pieces.get(move.from);
    if (!group) return;
    pieces.delete(move.from);

    for (let i = 1; i < move.path.length; i++) {
      const start = squareCentre(move.path[i - 1]);
      const end = squareCentre(move.path[i]);
      const distance = start.distanceTo(end);
      const arc = Math.min(1.1, 0.22 + distance * 0.1);

      await tween(250 + distance * 22, (t) => {
        const e = easeInOut(t);
        group.position.lerpVectors(start, end, e);
        group.position.y = Math.sin(Math.PI * e) * arc;
      });
      group.position.copy(end);

      const victim = move.captured[i - 1];
      if (victim !== undefined) await removePiece(victim);
    }

    if (move.promotes) {
      pieceGroup.remove(group);
      const king = place(move.to, move.piece > 0 ? 2 : -2);
      await tween(320, (t) => {
        const e = easeInOut(t);
        king.position.y = Math.sin(Math.PI * e) * 0.5;
        king.scale.setScalar(1 + Math.sin(Math.PI * e) * 0.16);
      });
      king.position.y = 0;
      king.scale.setScalar(1);
      return;
    }

    group.userData.square = move.to;
    for (const child of group.children) child.userData.square = move.to;
    pieces.set(move.to, group);
  }

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressed = null;

  renderer.domElement.addEventListener('pointerdown', (event) => {
    pressed = { x: event.clientX, y: event.clientY, t: performance.now() };
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!pressed || !onPick) return;
    // If the pointer travelled, the user was orbiting the camera, not clicking.
    const travelled = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
    const held = performance.now() - pressed.t;
    pressed = null;
    if (travelled > 6 || held > 700) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObjects([pieceGroup, squareGroup], true);
    const hit = hits.find((candidate) => candidate.object.userData.square !== undefined);
    if (hit) onPick(hit.object.userData.square);
  });

  // ---------- loop ----------
  // Until the user touches the camera, the board keeps itself inside the frame:
  // a narrow panel needs more distance than a wide one.
  let cameraTouchedByUser = false;
  controls.addEventListener('start', () => { cameraTouchedByUser = true; });

  function framingDistance() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max(FRAMING_RADIUS / Math.sin(vFov / 2), FRAMING_RADIUS / Math.sin(hFov / 2));
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    if (!cameraTouchedByUser) {
      const distance = THREE.MathUtils.clamp(framingDistance(), controls.minDistance, controls.maxDistance);
      camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
      controls.update();
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let running = true;
  (function draw() {
    if (!running) return;
    requestAnimationFrame(draw);
    controls.update();
    renderer.render(scene, camera);
  })();

  return {
    syncBoard,
    playMove,
    setHighlights,
    dispose() {
      running = false;
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
