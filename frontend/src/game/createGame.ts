import { WorldScene, type SceneDeps } from "./scenes/WorldScene";

/** A handle shaped like the old Phaser game, so the stage and the e2e scripts keep working. */
export interface GameHandle {
  destroy(removeCanvas?: boolean): void;
  scene: { getScene(key: string): WorldScene | null };
}

export function createGame(parent: HTMLElement, deps: SceneDeps): { game: GameHandle; scene: () => WorldScene | null } {
  let world: WorldScene | null = new WorldScene(parent, deps);
  const game: GameHandle = {
    destroy() {
      world?.destroy();
      world = null;
    },
    scene: { getScene: (key) => (key === "world" ? world : null) },
  };
  return { game, scene: () => world };
}
