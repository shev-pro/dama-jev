/**
 * La scacchiera in tre dimensioni.
 *
 * Questo modulo non sa niente di regole: riceve posizioni e mosse gia
 * validate, le disegna e le anima, e dice verso l'alto su quale casella ha
 * cliccato l'utente. Tutte le decisioni di gioco stanno altrove.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EMPTY, isKing, squareToRC } from './rules.js';

const COLORI = {
  scuro: 0x1d2733,
  chiaro: 0xd9cbb4,
  cornice: 0x3a2a1c,
  corniceBordo: 0x241a11,
  umano: 0xe8ddc8,
  jev: 0x113f42,
  jevLuce: 0x0c2f33,
  oro: 0xc9a227,
  selezione: 0xe8a33d,
  bersaglio: 0x3fd0c9,
  scia: 0x2a6b74,
};

const RAGGIO = 0.37;
const ALTEZZA_PEDINA = 0.17;
const ALTEZZA_DISCO_DAMA = 0.14;

/** Il centro di una casella nel mondo: x cresce verso destra, z verso chi guarda. */
function centroCasella(square) {
  const [row, col] = squareToRC(square);
  return new THREE.Vector3(col - 4.5, 0, row - 4.5);
}

function profiloDisco(raggio, altezza) {
  const smusso = 0.045;
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(raggio - smusso, 0),
    new THREE.Vector2(raggio, smusso),
    new THREE.Vector2(raggio, altezza - smusso),
    new THREE.Vector2(raggio - smusso, altezza),
    new THREE.Vector2(0, altezza),
  ];
}

const facile = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Le etichette con i numeri delle caselle, disegnate una volta sola su una texture. */
function texturaNumeri() {
  const lato = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = lato;
  const ctx = canvas.getContext('2d');
  const passo = lato / 10;

  ctx.font = `600 ${Math.round(passo * 0.24)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(160, 182, 205, 0.42)';

  for (let square = 1; square <= 50; square++) {
    const [row, col] = squareToRC(square);
    ctx.fillText(String(square), (col + 0.5) * passo, (row + 0.5) * passo + passo * 0.29);
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
  const DIREZIONE_CAMERA = new THREE.Vector3(0, 11.5, 11).normalize();
  const RAGGIO_INQUADRATURA = 7.9; // mezza scacchiera piu un margine di cornice
  camera.position.copy(DIREZIONE_CAMERA).multiplyScalar(16);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 9;
  controls.maxDistance = 34;
  controls.maxPolarAngle = Math.PI / 2.12; // mai sotto il piano della scacchiera
  controls.enablePan = false;

  // ---------- luci ----------
  scene.add(new THREE.HemisphereLight(0x9fb4cc, 0x090b0f, 0.5));

  const chiave = new THREE.DirectionalLight(0xfff2dc, 2.1);
  chiave.position.set(6.5, 13, 7.5);
  chiave.castShadow = true;
  chiave.shadow.mapSize.set(2048, 2048);
  chiave.shadow.camera.left = -9;
  chiave.shadow.camera.right = 9;
  chiave.shadow.camera.top = 9;
  chiave.shadow.camera.bottom = -9;
  chiave.shadow.camera.near = 1;
  chiave.shadow.camera.far = 32;
  chiave.shadow.bias = -0.0012;
  chiave.shadow.normalBias = 0.02;
  scene.add(chiave);

  const riempimento = new THREE.DirectionalLight(0x6f8fb5, 0.45);
  riempimento.position.set(-7, 6, -6);
  scene.add(riempimento);

  // ---------- cornice ----------
  const cornice = new THREE.Mesh(
    new THREE.BoxGeometry(11.6, 0.6, 11.6),
    new THREE.MeshStandardMaterial({ color: COLORI.cornice, roughness: 0.72, metalness: 0.05 }),
  );
  cornice.position.y = -0.31;
  cornice.receiveShadow = true;
  scene.add(cornice);

  const bordo = new THREE.Mesh(
    new THREE.BoxGeometry(12.2, 0.32, 12.2),
    new THREE.MeshStandardMaterial({ color: COLORI.corniceBordo, roughness: 0.85 }),
  );
  bordo.position.y = -0.58;
  scene.add(bordo);

  // ---------- caselle ----------
  const geometriaCasella = new THREE.BoxGeometry(1, 0.06, 1);
  const materialeChiaro = new THREE.MeshStandardMaterial({ color: COLORI.chiaro, roughness: 0.62 });
  const caselle = new Map(); // numero casella -> mesh (solo le scure, quelle giocabili)
  const gruppoCaselle = new THREE.Group();

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const giocabile = (row + col) % 2 === 1;
      const materiale = giocabile
        ? new THREE.MeshStandardMaterial({ color: COLORI.scuro, roughness: 0.55 })
        : materialeChiaro;
      const mesh = new THREE.Mesh(geometriaCasella, materiale);
      mesh.position.set(col - 4.5, -0.03, row - 4.5);
      mesh.receiveShadow = true;
      if (giocabile) {
        mesh.userData.square = row * 5 + (row % 2 === 0 ? (col - 1) / 2 : col / 2) + 1;
        caselle.set(mesh.userData.square, mesh);
      }
      gruppoCaselle.add(mesh);
    }
  }
  scene.add(gruppoCaselle);

  const numeri = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: texturaNumeri(), transparent: true, depthWrite: false }),
  );
  numeri.position.y = 0.002;
  numeri.raycast = () => {}; // non deve intercettare i click
  scene.add(numeri);

  // ---------- pezzi ----------
  const geometriaPedina = new THREE.LatheGeometry(profiloDisco(RAGGIO, ALTEZZA_PEDINA), 48);
  const geometriaDisco = new THREE.LatheGeometry(profiloDisco(RAGGIO, ALTEZZA_DISCO_DAMA), 48);
  const geometriaAnello = new THREE.TorusGeometry(RAGGIO - 0.01, 0.028, 10, 44).rotateX(Math.PI / 2);

  const materiali = {
    umano: new THREE.MeshStandardMaterial({ color: COLORI.umano, roughness: 0.38, metalness: 0.06 }),
    jev: new THREE.MeshStandardMaterial({
      color: COLORI.jev, roughness: 0.32, metalness: 0.18,
      emissive: COLORI.jevLuce, emissiveIntensity: 0.9,
    }),
    oro: new THREE.MeshStandardMaterial({ color: COLORI.oro, roughness: 0.28, metalness: 0.85 }),
  };

  function creaPezzo(codice) {
    const gruppo = new THREE.Group();
    const materiale = codice > 0 ? materiali.umano : materiali.jev;

    if (isKing(codice)) {
      for (const y of [0, ALTEZZA_DISCO_DAMA]) {
        const disco = new THREE.Mesh(geometriaDisco, materiale);
        disco.position.y = y;
        disco.castShadow = true;
        disco.receiveShadow = true;
        gruppo.add(disco);
      }
      const anello = new THREE.Mesh(geometriaAnello, materiali.oro);
      anello.position.y = ALTEZZA_DISCO_DAMA;
      anello.castShadow = true;
      gruppo.add(anello);
    } else {
      const disco = new THREE.Mesh(geometriaPedina, materiale);
      disco.castShadow = true;
      disco.receiveShadow = true;
      gruppo.add(disco);
    }

    gruppo.userData.codice = codice;
    return gruppo;
  }

  const pezzi = new Map(); // numero casella -> gruppo
  const gruppoPezzi = new THREE.Group();
  scene.add(gruppoPezzi);

  function metti(square, codice) {
    const gruppo = creaPezzo(codice);
    gruppo.position.copy(centroCasella(square));
    gruppo.userData.square = square;
    for (const figlio of gruppo.children) figlio.userData.square = square;
    gruppoPezzi.add(gruppo);
    pezzi.set(square, gruppo);
    return gruppo;
  }

  function svuota() {
    for (const gruppo of pezzi.values()) gruppoPezzi.remove(gruppo);
    pezzi.clear();
  }

  function syncBoard(state) {
    svuota();
    for (let square = 1; square <= 50; square++) {
      if (state.board[square] !== EMPTY) metti(square, state.board[square]);
    }
  }

  // ---------- evidenziazioni ----------
  const anelliBersaglio = new THREE.Group();
  scene.add(anelliBersaglio);
  const geometriaBersaglio = new THREE.RingGeometry(0.27, 0.35, 40).rotateX(-Math.PI / 2);
  const materialeBersaglio = new THREE.MeshBasicMaterial({
    color: COLORI.bersaglio, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });

  let evidenziate = { selected: null, targets: [], trail: [], hint: [] };

  function setHighlights(next = {}) {
    evidenziate = { selected: null, targets: [], trail: [], hint: [], ...next };

    for (const [square, mesh] of caselle) {
      const emissive = mesh.material.emissive;
      if (square === evidenziate.selected) emissive.setHex(COLORI.selezione).multiplyScalar(0.55);
      else if (evidenziate.hint.includes(square)) emissive.setHex(COLORI.selezione).multiplyScalar(0.4);
      else if (evidenziate.targets.includes(square)) emissive.setHex(COLORI.bersaglio).multiplyScalar(0.3);
      else if (evidenziate.trail.includes(square)) emissive.setHex(COLORI.scia).multiplyScalar(0.35);
      else emissive.setHex(0x000000);
    }

    anelliBersaglio.clear();
    for (const square of evidenziate.targets) {
      const anello = new THREE.Mesh(geometriaBersaglio, materialeBersaglio);
      anello.position.copy(centroCasella(square)).setY(0.012);
      anelliBersaglio.add(anello);
    }
  }
  setHighlights();

  // ---------- animazioni ----------
  function tween(durata, passo) {
    return new Promise((resolve) => {
      const inizio = performance.now();
      const frame = (ora) => {
        const t = Math.min(1, (ora - inizio) / durata);
        passo(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function togliPezzo(square) {
    const gruppo = pezzi.get(square);
    if (!gruppo) return;
    pezzi.delete(square);
    await tween(230, (t) => {
      const e = facile(t);
      gruppo.position.y = -0.45 * e;
      gruppo.scale.setScalar(Math.max(0.001, 1 - e));
    });
    gruppoPezzi.remove(gruppo);
  }

  /**
   * Anima la mossa gia decisa. Ogni salto della catena viene percorso a uno a
   * uno, e il pezzo mangiato sparisce subito dopo il salto che lo scavalca:
   * cosi si vede quale pezzo e caduto per quale salto.
   */
  async function playMove(move) {
    const gruppo = pezzi.get(move.from);
    if (!gruppo) return;
    pezzi.delete(move.from);

    for (let i = 1; i < move.path.length; i++) {
      const partenza = centroCasella(move.path[i - 1]);
      const arrivo = centroCasella(move.path[i]);
      const distanza = partenza.distanceTo(arrivo);
      const salto = Math.min(1.1, 0.22 + distanza * 0.1);

      await tween(250 + distanza * 22, (t) => {
        const e = facile(t);
        gruppo.position.lerpVectors(partenza, arrivo, e);
        gruppo.position.y = Math.sin(Math.PI * e) * salto;
      });
      gruppo.position.copy(arrivo);

      const preda = move.captured[i - 1];
      if (preda !== undefined) await togliPezzo(preda);
    }

    if (move.promotes) {
      gruppoPezzi.remove(gruppo);
      const dama = metti(move.to, move.piece > 0 ? 2 : -2);
      await tween(320, (t) => {
        const e = facile(t);
        dama.position.y = Math.sin(Math.PI * e) * 0.5;
        dama.scale.setScalar(1 + Math.sin(Math.PI * e) * 0.16);
      });
      dama.position.y = 0;
      dama.scale.setScalar(1);
      return;
    }

    gruppo.userData.square = move.to;
    for (const figlio of gruppo.children) figlio.userData.square = move.to;
    pezzi.set(move.to, gruppo);
  }

  // ---------- click ----------
  const raycaster = new THREE.Raycaster();
  const puntatore = new THREE.Vector2();
  let giu = null;

  renderer.domElement.addEventListener('pointerdown', (event) => {
    giu = { x: event.clientX, y: event.clientY, t: performance.now() };
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!giu || !onPick) return;
    // Se il puntatore si e mosso, l'utente stava ruotando la camera, non cliccando.
    const spostamento = Math.hypot(event.clientX - giu.x, event.clientY - giu.y);
    const durata = performance.now() - giu.t;
    giu = null;
    if (spostamento > 6 || durata > 700) return;

    const rect = renderer.domElement.getBoundingClientRect();
    puntatore.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    puntatore.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(puntatore, camera);

    const colpiti = raycaster.intersectObjects([gruppoPezzi, gruppoCaselle], true);
    const bersaglio = colpiti.find((hit) => hit.object.userData.square !== undefined);
    if (bersaglio) onPick(bersaglio.object.userData.square);
  });

  // ---------- ciclo ----------
  // Finche l'utente non tocca la camera, la scacchiera si tiene da sola dentro
  // l'inquadratura: in un pannello stretto serve piu distanza che in uno largo.
  let cameraTocccataDallUtente = false;
  controls.addEventListener('start', () => { cameraTocccataDallUtente = true; });

  function distanzaPerInquadrare() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return Math.max(RAGGIO_INQUADRATURA / Math.sin(vFov / 2), RAGGIO_INQUADRATURA / Math.sin(hFov / 2));
  }

  function ridimensiona() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    if (!cameraTocccataDallUtente) {
      const distanza = THREE.MathUtils.clamp(distanzaPerInquadrare(), controls.minDistance, controls.maxDistance);
      camera.position.copy(DIREZIONE_CAMERA).multiplyScalar(distanza);
      controls.update();
    }
  }
  const osservatore = new ResizeObserver(ridimensiona);
  osservatore.observe(container);
  ridimensiona();

  let vivo = true;
  (function disegna() {
    if (!vivo) return;
    requestAnimationFrame(disegna);
    controls.update();
    renderer.render(scene, camera);
  })();

  return {
    syncBoard,
    playMove,
    setHighlights,
    dispose() {
      vivo = false;
      osservatore.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
