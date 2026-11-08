/**
 * The home-page diorama: a small floating island where the contestants wander, chat and idle,
 * with your chosen contestant waving in front. Purely decorative; no networking.
 */
import * as THREE from "three";
import type { Cosmetics } from "../archetypes";
import { ARCHETYPES } from "../archetypes";
import { block, buildFigure, type Figure } from "./figure";
import { isoPalette } from "./palette3d";

const LINES = [
  "Where were you?!",
  "It wasn't me 👀",
  "I saw Lyra near the well…",
  "Skip vote!",
  "Who rang the bell?",
  "Beacons first!",
  "Sus.",
  "I was fixing the tower!",
  "Trust me 😇",
  "Stick together!",
];

interface Walker {
  figure: Figure;
  angle: number;
  radius: number;
  speed: number;
  pause: number;
  bubbleAnchor: THREE.Vector3;
}

export interface Diorama {
  setHero(archetype: string, cosmetics?: Cosmetics): void;
  destroy(): void;
}

export function createDiorama(host: HTMLElement, archetype: string, reduced: boolean): Diorama {
  const p = isoPalette("summer");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  host.appendChild(renderer.domElement);
  const overlay = document.createElement("div");
  overlay.className = "iso-overlay";
  host.appendChild(overlay);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff8ec, 0xc9b98f, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-5, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  scene.add(sun);

  // The island: a grassy top on a chunky earth base, a path, trees, the watchtower and a beacon.
  const island = new THREE.Group();
  scene.add(island);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.35, 10), new THREE.MeshLambertMaterial({ color: p.floor[2], flatShading: true }));
  top.position.y = -0.175;
  top.receiveShadow = true;
  island.add(top);
  const earth = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 3.6, 1.6, 10), new THREE.MeshLambertMaterial({ color: p.floor[11], flatShading: true }));
  earth.position.y = -1.15;
  island.add(earth);
  const path = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.9, 24), new THREE.MeshLambertMaterial({ color: p.floor[3] }));
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.01;
  path.receiveShadow = true;
  island.add(path);
  for (const [x, z, s] of [[-4, -1.2, 1], [-3.2, -3, 0.8], [3.6, -2.6, 1.1], [4.1, 0.6, 0.85], [-1.2, -4.3, 0.9], [1.8, -4.1, 0.75]] as const) {
    const tree = new THREE.Group();
    tree.add(block(0.2, 0.6, 0.2, p.trunk, 0, 0, 0, true));
    tree.add(block(0.9 * s, 0.8 * s, 0.9 * s, p.canopy[Math.floor((x + 5) % 4)]!, 0, 0.55, 0, true));
    tree.add(block(0.55 * s, 0.4 * s, 0.55 * s, p.canopy[Math.floor((z + 5) % 4)]!, 0, 0.55 + 0.8 * s, 0, true));
    tree.position.set(x, 0, z);
    tree.rotation.y = x * 1.3;
    island.add(tree);
  }
  const tower = new THREE.Group();
  tower.add(block(1.3, 0.4, 1.3, p.stone));
  tower.add(block(1.0, 1.9, 1.0, p.stone, 0, 0.4));
  tower.add(block(1.4, 0.12, 1.4, p.wood, 0, 2.3));
  tower.add(block(0.8, 0.45, 0.8, "#3d7bb6", 0, 2.42));
  tower.position.set(0, 0, 0);
  island.add(tower);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.4, 5),
    new THREE.MeshLambertMaterial({ color: p.fire, emissive: p.fire, emissiveIntensity: 0.9, flatShading: true }),
  );
  const beacon = new THREE.Group();
  beacon.add(block(0.4, 0.5, 0.4, p.stone));
  beacon.add(block(0.5, 0.1, 0.5, p.wood, 0, 0.5));
  flame.position.y = 0.8;
  beacon.add(flame);
  beacon.position.set(-3.8, 0, 1.9);
  island.add(beacon);

  // Wanderers: everyone except the hero walks the ring path; one is the "impostor".
  const keys = Object.keys(ARCHETYPES);
  const walkers: Walker[] = [];
  const others = keys.filter((k) => k !== archetype).slice(0, 6);
  others.forEach((k, i) => {
    const f = buildFigure(k);
    island.add(f.root);
    walkers.push({
      figure: f,
      angle: (i / others.length) * Math.PI * 2,
      radius: 2.5 + (i % 2) * 0.2,
      speed: (0.22 + (i % 3) * 0.05) * (i % 2 ? 1 : -1),
      pause: 0,
      bubbleAnchor: new THREE.Vector3(),
    });
  });
  const impostor = walkers[2];
  const mark = document.createElement("div");
  mark.className = "diorama-sus";
  mark.textContent = "?";
  overlay.appendChild(mark);

  let hero: Figure | null = null;
  const heroPos = new THREE.Vector3(3.1, 0, 3.1); // front and centre, facing the camera
  function setHero(a: string, cosmetics?: Cosmetics): void {
    hero?.dispose();
    hero = buildFigure(a, cosmetics);
    hero.root.position.copy(heroPos);
    hero.root.scale.setScalar(1.45);
    hero.root.rotation.y = Math.PI / 4;
    island.add(hero.root);
  }
  setHero(archetype);

  // Camera: orthographic, isometric-ish, with a slow sway.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  function resize(): void {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h);
    const viewH = w < 560 ? 12 : 9.5;
    camera.left = (-viewH * (w / h)) / 2;
    camera.right = (viewH * (w / h)) / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Speech bubbles: one at a time, over a random wanderer.
  const bubble = document.createElement("div");
  bubble.className = "iso-bubble diorama-bubble";
  const bubbleText = document.createElement("div");
  bubbleText.className = "iso-bubble-text";
  bubble.appendChild(bubbleText);
  overlay.appendChild(bubble);
  let talker: Walker | null = null;
  let lineIndex = 0;
  function nextLine(): void {
    talker = walkers[Math.floor(Math.random() * walkers.length)] ?? null;
    bubbleText.textContent = LINES[lineIndex++ % LINES.length]!;
    bubble.classList.remove("diorama-pop");
    void bubble.offsetWidth; // restart the pop animation
    bubble.classList.add("diorama-pop");
  }
  nextLine();
  const talkTimer = window.setInterval(nextLine, 2600);

  const v = new THREE.Vector3();
  function toScreen(obj: THREE.Object3D, y: number): { x: number; y: number } {
    obj.getWorldPosition(v);
    v.y += y;
    v.project(camera);
    return { x: ((v.x + 1) / 2) * host.clientWidth, y: ((1 - v.y) / 2) * host.clientHeight };
  }

  let raf = 0;
  let last = 0;
  let visible = true;
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
  });
  io.observe(host);

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) {
      last = now;
      return;
    }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const t = now / 1000;
    const sway = reduced ? 0 : Math.sin(t * 0.25) * 0.35;
    camera.position.set(Math.sin(Math.PI / 4 + sway) * 30, 22, Math.cos(Math.PI / 4 + sway) * 30);
    camera.lookAt(0, 0.6, 0);
    for (const w of walkers) {
      if (w.pause > 0) {
        w.pause -= dt;
        w.figure.animate(dt, 0, { aim: false, reduced });
      } else {
        w.angle += (w.speed * dt) / w.radius * 2;
        if (!reduced && Math.random() < dt * 0.15) w.pause = 1 + Math.random() * 1.5;
        w.figure.animate(dt, reduced ? 0 : 1, { aim: false, reduced });
      }
      const x = Math.cos(w.angle) * w.radius;
      const z = Math.sin(w.angle) * w.radius;
      w.figure.root.position.set(x, 0, z);
      // Face along the ring in the walking direction.
      w.figure.root.rotation.y = Math.atan2(-Math.sin(w.angle) * Math.sign(w.speed), Math.cos(w.angle) * Math.sign(w.speed));
    }
    if (hero) {
      // The hero waves: arms up and down via the "ready" pose, on a gentle loop.
      hero.animate(dt, 0, { aim: !reduced && Math.sin(t * 2.2) > 0.3, reduced });
      hero.root.rotation.y = Math.PI / 4 + (reduced ? 0 : Math.sin(t * 0.8) * 0.3);
    }
    flame.scale.y = reduced ? 1 : 1 + Math.sin(t * 11) * 0.15;
    renderer.render(scene, camera);
    if (talker) {
      const s = toScreen(talker.figure.root, 1.75);
      bubble.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
    if (impostor) {
      const s = toScreen(impostor.figure.root, 1.9);
      mark.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    setHero,
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(talkTimer);
      ro.disconnect();
      io.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
