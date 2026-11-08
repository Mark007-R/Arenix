/**
 * Short-lived hit effects for each attack style: slash arcs, magic bursts, flying leaves, and
 * arrows or pebbles that fly from the attacker to the target.
 */
import * as THREE from "three";
import type { StrikeStyle } from "./figure";

interface Live {
  delay: number;
  age: number;
  life: number;
  obj: THREE.Object3D;
  started: boolean;
  start(): void;
  tick(u: number, dt: number): void;
}

const ARC_GEO = new THREE.RingGeometry(0.45, 0.62, 18, 1, 0, Math.PI);
const BURST_GEO = new THREE.IcosahedronGeometry(0.3, 1);
const LEAF_GEO = new THREE.BoxGeometry(0.09, 0.03, 0.09);
const ARROW_GEO = new THREE.BoxGeometry(0.03, 0.03, 0.42);
const PEBBLE_GEO = new THREE.BoxGeometry(0.09, 0.09, 0.09);

function fadeMat(color: string | number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
}

export class Effects {
  private live: Live[] = [];

  constructor(private scene: THREE.Scene) {}

  /**
   * Play `style`'s hit effect. `from` is the attacker's position, `to` the target's (ground level);
   * `delay` is when the blow lands, so the effect matches the swing.
   */
  hit(style: StrikeStyle, from: THREE.Vector3, to: THREE.Vector3, delay: number, accent: string): void {
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    switch (style) {
      case "chop":
      case "slash":
      case "spin":
      case "stab":
      case "sweep": {
        const arc = new THREE.Mesh(ARC_GEO, fadeMat(style === "sweep" ? "#b6dc6a" : "#ffffff"));
        arc.position.set(to.x, style === "chop" ? 0.85 : 0.75, to.z);
        // Chops fall vertically; the rest swing across.
        if (style === "chop") arc.rotation.set(0, yaw + Math.PI / 2, Math.PI / 2);
        else arc.rotation.set(-Math.PI / 2 + 0.3, 0, yaw);
        this.add(delay, 0.32, arc, (u) => {
          arc.scale.setScalar(0.7 + u * 0.8);
          (arc.material as THREE.MeshBasicMaterial).opacity = 1 - u;
        });
        if (style === "sweep") this.leaves(to, delay);
        if (style === "spin") this.burst(to, delay, "#f2b134", 0.35);
        break;
      }
      case "cast":
        this.burst(to, delay, accent, 0.45);
        this.burst(to, delay + 0.06, "#ffffff", 0.3);
        break;
      case "draw": {
        // An arrow, or a pebble for the slingshot, flies from the attacker's hand to the target.
        const pebble = accent === "pebble";
        const shot = new THREE.Mesh(pebble ? PEBBLE_GEO : ARROW_GEO, fadeMat(pebble ? "#9aa3ad" : "#8a5a3c"));
        shot.rotation.y = yaw;
        const a = new THREE.Vector3(from.x, 0.95, from.z);
        const b = new THREE.Vector3(to.x, 0.8, to.z);
        this.add(delay, 0.2, shot, (u) => {
          shot.position.lerpVectors(a, b, u);
          if (pebble) shot.rotation.x += 0.6;
        });
        this.burst(to, delay + 0.2, "#ffffff", 0.18);
        break;
      }
    }
  }

  private burst(at: THREE.Vector3, delay: number, color: string, life: number): void {
    const ball = new THREE.Mesh(BURST_GEO, fadeMat(color));
    ball.position.set(at.x, 0.8, at.z);
    this.add(delay, life, ball, (u) => {
      ball.scale.setScalar(0.4 + u * 2.4);
      (ball.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - u);
    });
  }

  private leaves(at: THREE.Vector3, delay: number): void {
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(LEAF_GEO, fadeMat(i % 2 ? "#5fb04f" : "#7cc35a"));
      const a = (i / 9) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 1.6, 2 + (i % 3) * 0.6, Math.sin(a) * 1.6);
      leaf.position.set(at.x, 0.8, at.z);
      this.add(delay, 0.7, leaf, (_u, dt) => {
        v.y -= 6 * dt;
        leaf.position.addScaledVector(v, dt);
        leaf.rotation.x += dt * 8;
        leaf.rotation.z += dt * 5;
        (leaf.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - _u);
      });
    }
  }

  private add(delay: number, life: number, obj: THREE.Object3D, tick: (u: number, dt: number) => void): void {
    const scene = this.scene;
    this.live.push({
      delay, age: 0, life, obj, started: false,
      start() {
        scene.add(obj);
      },
      tick,
    });
  }

  update(dt: number): void {
    for (const e of this.live) {
      if (e.delay > 0) {
        e.delay -= dt;
        continue;
      }
      if (!e.started) {
        e.started = true;
        e.start();
      }
      e.age += dt;
      e.tick(Math.min(1, e.age / e.life), dt);
    }
    const done = this.live.filter((e) => e.started && e.age >= e.life);
    for (const e of done) {
      e.obj.removeFromParent();
      const m = (e.obj as THREE.Mesh).material as THREE.Material | undefined;
      m?.dispose();
    }
    this.live = this.live.filter((e) => !(e.started && e.age >= e.life));
  }

  clear(): void {
    for (const e of this.live) e.obj.removeFromParent();
    this.live = [];
  }
}
