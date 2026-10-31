/** Renders a 3D figure to a still image for menus, lobbies and lists (cached per look and size). */
import * as THREE from "three";
import type { Cosmetics } from "../archetypes";
import { buildFigure } from "./figure";

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function sharedRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

export function portraitURL(archetype: string, cosmetics: Cosmetics | undefined, width: number, height: number): string {
  const key = `${archetype}~${cosmetics?.skin?.id ?? ""}~${cosmetics?.hat?.id ?? ""}~${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = sharedRenderer();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  r.setPixelRatio(ratio);
  r.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff8ec, 0xb5ab98, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-3, 5, 4);
  scene.add(sun);
  const fig = buildFigure(archetype, cosmetics);
  fig.animate(0.016, 0, { aim: false, reduced: true });
  fig.root.rotation.y = 0.55;
  scene.add(fig.root);
  // Frame the whole figure (about 1.8 units tall with headgear), seen slightly from above.
  const aspect = width / height;
  const viewH = 1.75;
  const cam = new THREE.OrthographicCamera((-viewH * aspect) / 2, (viewH * aspect) / 2, viewH / 2, -viewH / 2, 0.1, 50);
  cam.position.set(0, 1.9 + 3, 9);
  cam.lookAt(0, 0.85, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
