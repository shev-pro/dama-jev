/**
 * The board in three dimensions.
 *
 * This module knows nothing about the rules: it receives positions and moves
 * that the server has already validated, draws and animates them, and reports
 * upwards which square the user clicked. Every game decision lives elsewhere.
 *
 * The board itself is rebuilt whenever the variant changes, because both its
 * size and which diagonal it plays on can differ.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EMPTY, isKing, geometryFor } from './board.js';

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

/** The square numbers, drawn once onto a single texture per board. */
function numbersTexture(geometry) {
  const side = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d');
  const step = side / geometry.size;

  ctx.font = `600 ${Math.round(step * 0.24)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(160, 182, 205, 0.42)';

  for (let square = 1; square <= geometry.total; square++) {
    const [row, col] = geometry.squareToRC(square);
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
  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 34;
  controls.maxPolarAngle = Math.PI / 2.12; // never below the plane of the board
  controls.enablePan = false;

  // ---------- lighting ----------
  scene.add(new THREE.HemisphereLight(0x9fb4cc, 0x090b0f, 0.5));

  const keyLight = new THREE.DirectionalLight(0xfff2dc, 2.1);
  keyLight.position.set(6.5, 13, 7.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 32;
  keyLight.shadow.bias = -0.0012;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x6f8fb5, 0.45);
  fillLight.position.set(-7, 6, -6);
  scene.add(fillLight);

  // ---------- shared geometry and materials ----------
  const squareGeometry = new THREE.BoxGeometry(1, 0.06, 1);
  const lightMaterial = new THREE.MeshStandardMaterial({ color: COLORS.light, roughness: 0.62 });
  const manGeometry = new THREE.LatheGeometry(discProfile(RADIUS, MAN_HEIGHT), 48);
  const discGeometry = new THREE.LatheGeometry(discProfile(RADIUS, KING_DISC_HEIGHT), 48);
  const ringGeometry = new THREE.TorusGeometry(RADIUS - 0.01, 0.028, 10, 44).rotateX(Math.PI / 2);
  const targetGeometry = new THREE.RingGeometry(0.27, 0.35, 40).rotateX(-Math.PI / 2);

  const materials = {
    human: new THREE.MeshStandardMaterial({ color: COLORS.human, roughness: 0.38, metalness: 0.06 }),
    jev: new THREE.MeshStandardMaterial({
      color: COLORS.jev, roughness: 0.32, metalness: 0.18,
      emissive: COLORS.jevGlow, emissiveIntensity: 0.9,
    }),
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: 0.28, metalness: 0.85 }),
    target: new THREE.MeshBasicMaterial({
      color: COLORS.target, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    }),
  };

  const boardGroup = new THREE.Group();
  const squareGroup = new THREE.Group();
  const pieceGroup = new THREE.Group();
  const targetRings = new THREE.Group();
  scene.add(boardGroup, squareGroup, pieceGroup, targetRings);

  // ---------- the board, rebuilt whenever the variant changes ----------
  let geometry = null;
  let squares = new Map();
  const pieces = new Map();
  let framingRadius = 8;

  const centre = (square) => {
    const [row, col] = geometry.squareToRC(square);
    const offset = (geometry.size - 1) / 2;
    return new THREE.Vector3(col - offset, 0, row - offset);
  };

  function disposeGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      // Only the per-board meshes own their material; the shared ones are reused.
      if (child.material?.userData?.perBoard) child.material.dispose();
      if (child.geometry?.userData?.perBoard) child.geometry.dispose();
    }
  }

  function buildBoard(variantShape) {
    geometry = geometryFor(variantShape.size, variantShape.boardParity);
    const { size } = geometry;

    disposeGroup(squareGroup);
    disposeGroup(boardGroup);
    pieces.clear();
    disposeGroup(pieceGroup);
    targetRings.clear();
    squares = new Map();

    const offset = (size - 1) / 2;

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(size + 1.6, 0.6, size + 1.6),
      new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: 0.72, metalness: 0.05 }),
    );
    frame.geometry.userData.perBoard = true;
    frame.material.userData.perBoard = true;
    frame.position.y = -0.31;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(size + 2.2, 0.32, size + 2.2),
      new THREE.MeshStandardMaterial({ color: COLORS.frameEdge, roughness: 0.85 }),
    );
    plinth.geometry.userData.perBoard = true;
    plinth.material.userData.perBoard = true;
    plinth.position.y = -0.58;
    boardGroup.add(plinth);

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const square = geometry.rcToSquare(row, col);
        const material = square
          ? new THREE.MeshStandardMaterial({ color: COLORS.dark, roughness: 0.55 })
          : lightMaterial;
        if (square) material.userData.perBoard = true;

        const mesh = new THREE.Mesh(squareGeometry, material);
        mesh.position.set(col - offset, -0.03, row - offset);
        mesh.receiveShadow = true;
        if (square) {
          mesh.userData.square = square;
          squares.set(square, mesh);
        }
        squareGroup.add(mesh);
      }
    }

    const numbers = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: numbersTexture(geometry), transparent: true, depthWrite: false }),
    );
    numbers.geometry.userData.perBoard = true;
    numbers.material.userData.perBoard = true;
    numbers.position.y = 0.002;
    numbers.raycast = () => {}; // must not swallow clicks
    boardGroup.add(numbers);

    // The shadow camera and the framing both follow the board size.
    const half = size / 2 + 1;
    Object.assign(keyLight.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    keyLight.shadow.camera.updateProjectionMatrix();
    framingRadius = size * 0.79;

    resize({ refit: true });
  }

  // ---------- pieces ----------
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

    return group;
  }

  function place(square, code) {
    const group = createPiece(code);
    group.position.copy(centre(square));
    group.userData.square = square;
    for (const child of group.children) child.userData.square = square;
    pieceGroup.add(group);
    pieces.set(square, group);
    return group;
  }

  function syncBoard(board) {
    for (const group of pieces.values()) pieceGroup.remove(group);
    pieces.clear();
    for (let square = 1; square <= geometry.total; square++) {
      if (board[square] !== EMPTY) place(square, board[square]);
    }
  }

  // ---------- highlights ----------
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
      const ring = new THREE.Mesh(targetGeometry, materials.target);
      ring.position.copy(centre(square)).setY(0.012);
      targetRings.add(ring);
    }
  }

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
   * Animates a move the server has already accepted. Each hop of the chain is
   * travelled one at a time, and the captured piece disappears right after the
   * hop that jumped it, so you can see which piece fell to which jump.
   */
  async function playMove(move) {
    const group = pieces.get(move.from);
    if (!group) return;
    pieces.delete(move.from);

    for (let i = 1; i < move.path.length; i++) {
      const start = centre(move.path[i - 1]);
      const end = centre(move.path[i]);
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
  // a narrow panel needs more distance than a wide one, and an 8x8 board less
  // than a 10x10 one.
  let cameraTouchedByUser = false;
  controls.addEventListener('start', () => { cameraTouchedByUser = true; });

  function framingDistance() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max(framingRadius / Math.sin(vFov / 2), framingRadius / Math.sin(hFov / 2));
  }

  function resize({ refit = false } = {}) {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    if (refit || !cameraTouchedByUser) {
      const distance = THREE.MathUtils.clamp(framingDistance(), controls.minDistance, controls.maxDistance);
      camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
      controls.update();
    }
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(container);

  let running = true;
  (function draw() {
    if (!running) return;
    requestAnimationFrame(draw);
    controls.update();
    renderer.render(scene, camera);
  })();

  return {
    buildBoard,
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
