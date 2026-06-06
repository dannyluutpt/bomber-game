import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";
import "./styles.css";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  transparent: true, // Phaser only runs logic now; Three.js (behind) renders the game
  backgroundColor: "rgba(0,0,0,0)",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight
  },
  pixelArt: true,
  roundPixels: true,
  scene: [GameScene]
});

window.addEventListener("beforeunload", () => { game.destroy(true); });
