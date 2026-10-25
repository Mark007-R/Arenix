import * as Phaser from "phaser";
import { WorldScene, type SceneDeps } from "./scenes/WorldScene";

export function createGame(parent: HTMLElement, deps: SceneDeps): { game: Phaser.Game; scene: () => WorldScene | null } {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: "#2f68b8",
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    fps: { target: 60 },
    banner: false,
    audio: { noAudio: true },
  });
  game.scene.add("world", WorldScene, true, deps);
  return { game, scene: () => (game.scene.getScene("world") as WorldScene | null) ?? null };
}
