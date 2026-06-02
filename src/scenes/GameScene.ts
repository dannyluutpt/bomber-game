import Phaser from "phaser";
import { CHARACTERS, DIFFICULTIES, GameModel } from "../simulation/GameModel";
import { LEVEL_HEIGHT, LEVEL_WIDTH } from "../simulation/level";
import type {
  BuffType,
  CharacterId,
  DifficultyId,
  Direction,
  GameMode,
  GameSnapshot,
  Player,
  PowerUpType,
  Vec2
} from "../simulation/types";

const COLORS = {
  floor: 0x0d1a26, floorAlt: 0x102132, grid: 0x1e4057,
  wall: 0x6f7f93, wallTop: 0xd5e3f3,
  brick: 0xa94a31, brickTop: 0xf0a35d,
  exit: 0x35f2d0,
  bomb: 0x0a0e17,
  flame: 0xfff2a8, flameHot: 0xff7a18,
  range: 0x35d9ff, speed: 0x80ed99, bombPower: 0xff4d9d,
  gemExtraLife: 0xff6b9d, gemPhaseWalk: 0xb5a8d5, gemMegaBlast: 0xff7c43,
  gemSpeedSurge: 0xffd166, gemShield: 0x06d6a0
};

type MenuScreen = "main" | "guide" | "mode" | "difficulty" | "character" | "character-p2" | "status";

export class GameScene extends Phaser.Scene {
  private model = new GameModel();
  private board!: Phaser.GameObjects.Container;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private moveCooldown = [0, 0];
  private lastPhase = "ready";

  // Smooth movement: sprites glide toward their target cell instead of teleporting.
  // Keyed by actor ("p0"/"p1"/"e<id>"); cleared on each match start.
  private renderPos = new Map<string, { x: number; y: number }>();
  private frameDelta = 16;

  // Persistent render objects — created once in create(), never destroyed per-frame
  // gTiles: static tile layer, redrawn only when bricks change
  // gDynamic: all vector drawing each frame (shadows, shields, items, bombs, explosions)
  // sprite/label pools: positioned each frame via setPosition/setVisible
  private gTiles!: Phaser.GameObjects.Graphics;
  private gDynamic!: Phaser.GameObjects.Graphics;
  private playerSprites: Phaser.GameObjects.Sprite[] = [];
  private playerLabels: Phaser.GameObjects.Text[] = [];
  private enemySprites: Phaser.GameObjects.Sprite[] = [];
  private lastBrickCount = -1;
  private activeTouchDirection: Direction | null = null;
  private selectedDifficulty: DifficultyId = "normal";
  private selectedCharacters: [CharacterId, CharacterId] = ["nova", "orion"];
  private selectedMode: GameMode = "single";
  private lastSeed = 0;
  private boundDomKeydown = (e: KeyboardEvent) => this.handleDomKeydown(e);

  private hud = {
    score: document.querySelector<HTMLElement>("#score"),
    score2: document.querySelector<HTMLElement>("#score2"),
    time: document.querySelector<HTMLElement>("#time"),
    bombs: document.querySelector<HTMLElement>("#bombs"),
    bombs2: document.querySelector<HTMLElement>("#bombs2"),
    range: document.querySelector<HTMLElement>("#range"),
    range2: document.querySelector<HTMLElement>("#range2"),
    lives: document.querySelector<HTMLElement>("#lives"),
    lives2: document.querySelector<HTMLElement>("#lives2"),
    enemies: document.querySelector<HTMLElement>("#enemies"),
    difficulty: document.querySelector<HTMLElement>("#difficulty-label"),
    overlay: document.querySelector<HTMLDivElement>("#overlay"),
    playNow: document.querySelector<HTMLButtonElement>("#play-now-button"),
    guide: document.querySelector<HTMLButtonElement>("#guide-button"),
    resume: document.querySelector<HTMLButtonElement>("#resume-button"),
    restart: document.querySelector<HTMLButtonElement>("#restart-button"),
    mainMenu: document.querySelector<HTMLButtonElement>("#main-menu-button"),
    backDifficulty: document.querySelector<HTMLButtonElement>("#back-difficulty-button"),
    backDifficultyP2: document.querySelector<HTMLButtonElement>("#back-character-button"),
    pause: document.querySelector<HTMLButtonElement>("#pause-button"),
    touchControls: document.querySelector<HTMLDivElement>("#touch-controls"),
    statusTitle: document.querySelector<HTMLElement>("#status-title"),
    statusCopy: document.querySelector<HTMLElement>("#status-copy"),
    statusEyebrow: document.querySelector<HTMLElement>("#status-eyebrow"),
    p2strip: document.querySelector<HTMLElement>("#hud-p2")
  };

  constructor() { super("GameScene"); }

  private get TILE(): number {
    const w = this.scale.width;
    const h = this.scale.height;
    return Math.min(
      Math.floor(w / LEVEL_WIDTH),
      Math.floor((h - 80) / LEVEL_HEIGHT)
    );
  }
  private get BOARD_X(): number { return Math.floor((this.scale.width - LEVEL_WIDTH * this.TILE) / 2); }
  private get BOARD_Y(): number { return 80; }

  preload(): void {
    this.load.spritesheet("rpgCharacters", `${import.meta.env.BASE_URL}assets/rpg_16x16.png`, {
      frameWidth: 16, frameHeight: 16
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#050914");
    this.createBackground();
    this.createBoardBacking();
    this.board = this.add.container(this.BOARD_X, this.BOARD_Y);
    this.createChrome();

    // --- persistent render pool: created once, reused every frame ---
    // Layer order in container: tiles (bottom) → dynamic vector → enemy sprites → player sprites → labels (top)
    this.gTiles = this.add.graphics();
    this.board.add(this.gTiles);
    this.gDynamic = this.add.graphics();  // shadows + shields + items + bombs + explosions
    this.board.add(this.gDynamic);

    const ENEMY_MAX = 4;
    for (let i = 0; i < ENEMY_MAX; i++) {
      const sp = this.add.sprite(0, 0, "rpgCharacters", 48);
      sp.setVisible(false); this.board.add(sp); this.enemySprites.push(sp);
    }
    const PLAYER_MAX = 2;
    for (let i = 0; i < PLAYER_MAX; i++) {
      const sp = this.add.sprite(0, 0, "rpgCharacters", 8);
      sp.setVisible(false); this.board.add(sp); this.playerSprites.push(sp);
      const lbl = this.add.text(0, 0, "", {
        fontFamily: "Courier New", fontSize: "10px",
        color: i === 0 ? "#ff4d9d" : "#35d9ff",
        stroke: "#000000", strokeThickness: 3
      });
      lbl.setVisible(false).setOrigin(0.5); this.board.add(lbl); this.playerLabels.push(lbl);
    }
    // -----------------------------------------------------------------

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,ENTER,P,ESC") as Record<string, Phaser.Input.Keyboard.Key>;

    this.scale.on("resize", () => {
      this.cameras.main.setBackgroundColor("#050914");
      this.createBackground();
      this.createBoardBacking();
      this.lastBrickCount = -1; // force tile redraw after resize
    });

    this.bindMenu();
    this.bindTouchControls();
    window.addEventListener("keydown", this.boundDomKeydown);

    this.showScreen("main");
    this.render(this.model.snapshot());
  }

  update(time: number, delta: number): void {
    this.frameDelta = delta;
    this.handleInput(time);
    this.model.update(time, delta);
    const snapshot = this.model.snapshot();
    this.render(snapshot);
    this.updateDom(snapshot);
  }

  // Ease a sprite's rendered position toward its target cell centre. Frame-rate
  // independent (exponential smoothing on delta). Snaps on first sight or on large
  // jumps (respawn, phase-walk eject, enemy sprite-pool reuse) so they don't streak.
  private smoothPos(key: string, tx: number, ty: number, tile: number): { x: number; y: number } {
    const prev = this.renderPos.get(key);
    if (!prev || Math.hypot(tx - prev.x, ty - prev.y) > tile * 1.5) {
      const pos = { x: tx, y: ty };
      this.renderPos.set(key, pos);
      return pos;
    }
    const factor = 1 - Math.exp(-18 * (this.frameDelta / 1000));
    prev.x += (tx - prev.x) * factor;
    prev.y += (ty - prev.y) * factor;
    return prev;
  }

  private bindMenu(): void {
    this.hud.playNow?.addEventListener("click", () => this.showScreen("mode"));
    this.hud.guide?.addEventListener("click", () => this.showScreen("guide"));
    this.hud.resume?.addEventListener("click", () => this.resumeGame());
    this.hud.restart?.addEventListener("click", () => this.restartGame());
    this.hud.mainMenu?.addEventListener("click", () => this.returnToMainMenu());
    this.hud.backDifficulty?.addEventListener("click", () => this.showScreen("difficulty"));
    this.hud.backDifficultyP2?.addEventListener("click", () => this.showScreen("character"));
    this.hud.pause?.addEventListener("click", () => this.togglePause());

    document.querySelectorAll<HTMLButtonElement>(".back-main-button").forEach((btn) => {
      btn.addEventListener("click", () => this.showScreen("main"));
    });
    document.querySelectorAll<HTMLButtonElement>(".back-mode-button").forEach((btn) => {
      btn.addEventListener("click", () => this.showScreen("mode"));
    });

    document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedMode = btn.dataset.mode as GameMode;
        this.markActive("[data-mode]", btn);
        this.showScreen("difficulty");
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedDifficulty = btn.dataset.difficulty as DifficultyId;
        this.markActive("[data-difficulty]", btn);
        this.showScreen("character");
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-character-p1]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedCharacters[0] = btn.dataset.characterP1 as CharacterId;
        this.markActive("[data-character-p1]", btn);
        if (this.selectedMode === "versus") {
          this.refreshP2CharacterScreen();
          this.showScreen("character-p2");
        } else {
          this.startGame();
        }
      });
    });

    document.querySelectorAll<HTMLButtonElement>("[data-character-p2]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedCharacters[1] = btn.dataset.characterP2 as CharacterId;
        this.markActive("[data-character-p2]", btn);
        this.startGame();
      });
    });
  }

  private refreshP2CharacterScreen(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-character-p2]").forEach((btn) => {
      const isTaken = btn.dataset.characterP2 === this.selectedCharacters[0];
      btn.disabled = isTaken;
      btn.classList.toggle("taken", isTaken);
    });
  }

  private markActive(selector: string, active: HTMLButtonElement): void {
    document.querySelectorAll(selector).forEach((btn) => btn.classList.remove("active"));
    active.classList.add("active");
  }

  private startGame(): void {
    this.lastBrickCount = -1;
    this.renderPos.clear();
    this.model.start({
      difficulty: this.selectedDifficulty,
      characters: [...this.selectedCharacters],
      mode: this.selectedMode,
      seed: this.nextSeed(),
      now: this.time.now
    });
    this.lastPhase = "playing";
    if (this.hud.p2strip) {
      this.hud.p2strip.style.display = this.selectedMode === "versus" ? "" : "none";
    }
    this.hideOverlay();
  }

  private restartGame(): void {
    this.lastBrickCount = -1;
    this.renderPos.clear();
    this.model.start({
      difficulty: this.selectedDifficulty,
      characters: [...this.selectedCharacters],
      mode: this.selectedMode,
      seed: this.nextSeed(),
      now: this.time.now
    });
    this.lastPhase = "playing";
    this.hideOverlay();
  }

  private resumeGame(): void {
    if (this.model.snapshot().phase === "paused") {
      this.model.setPaused(false);
      this.hideOverlay();
    }
  }

  private returnToMainMenu(): void {
    const snapshot = this.model.snapshot();
    if (snapshot.phase === "playing") this.model.setPaused(true);
    this.showScreen("main");
  }

  private togglePause(): void {
    const { phase } = this.model.snapshot();
    if (phase === "playing") {
      this.model.setPaused(true);
      this.showStatus("TẠM DỪNG", "Tạm dừng", "Bấm tiếp tục để quay lại.", true);
    } else if (phase === "paused") {
      this.resumeGame();
    }
  }

  private nextSeed(): number {
    let seed = Date.now() + Math.floor(Math.random() * 1000000);
    if (seed === this.lastSeed) seed += 1;
    this.lastSeed = seed;
    return seed;
  }

  private showScreen(screen: MenuScreen): void {
    document.querySelectorAll<HTMLElement>("[data-screen]").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.screen !== screen);
    });
    this.hud.overlay?.classList.add("visible");
  }

  private hideOverlay(): void { this.hud.overlay?.classList.remove("visible"); }

  private showStatus(eyebrow: string, title: string, copy: string, canResume: boolean): void {
    if (this.hud.statusEyebrow) this.hud.statusEyebrow.textContent = eyebrow;
    if (this.hud.statusTitle) this.hud.statusTitle.textContent = title;
    if (this.hud.statusCopy) this.hud.statusCopy.textContent = copy;
    if (this.hud.resume) this.hud.resume.style.display = canResume ? "" : "none";
    this.showScreen("status");
  }

  private handleInput(time: number): void {
    // Read live model fields directly — no full snapshot deep-copy needed for input
    if (this.model.phase !== "playing") return;

    this.handlePlayerInput(0, time);
    if (this.model.mode === "versus") this.handlePlayerInput(1, time);
  }

  private handlePlayerInput(playerIndex: 0 | 1, time: number): void {
    const player = this.model.players[playerIndex];
    if (!player?.alive) return;

    const isSingle = this.model.mode === "single";

    if (playerIndex === 0) {
      // In single player, both SPACE and ENTER plant bomb (backward-compatible)
      const bomb = Phaser.Input.Keyboard.JustDown(this.keys.SPACE) ||
        (isSingle && Phaser.Input.Keyboard.JustDown(this.keys.ENTER));
      if (bomb) this.model.plantBomb(0, time);
    } else {
      if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) this.model.plantBomb(1, time);
    }

    if (time < this.moveCooldown[playerIndex]) return;

    const dir = playerIndex === 0
      ? this.readDirectionP1(isSingle)
      : this.readDirectionP2();
    if (!dir) return;

    if (this.model.movePlayer(playerIndex, dir, time)) {
      const spd = this.model.getEffectiveSpeed(playerIndex);
      this.moveCooldown[playerIndex] = time + Math.max(75, 170 - spd * 25);
    }
  }

  private handleDomKeydown(event: KeyboardEvent): void {
    if (event.key !== "p" && event.key !== "P" && event.key !== "Escape") return;
    const { phase } = this.model.snapshot();
    if (phase === "playing" || phase === "paused") {
      event.preventDefault();
      this.togglePause();
    }
  }

  private readDirectionP1(isSingle: boolean): Direction | null {
    if (this.keys.A.isDown) return "left";
    if (this.keys.D.isDown) return "right";
    if (this.keys.W.isDown) return "up";
    if (this.keys.S.isDown) return "down";
    // In single player, arrow keys also work (backward-compatible with original game)
    if (isSingle) {
      if (this.cursors.left.isDown) return "left";
      if (this.cursors.right.isDown) return "right";
      if (this.cursors.up.isDown) return "up";
      if (this.cursors.down.isDown) return "down";
    }
    return this.activeTouchDirection;
  }

  private readDirectionP2(): Direction | null {
    if (this.cursors.left.isDown) return "left";
    if (this.cursors.right.isDown) return "right";
    if (this.cursors.up.isDown) return "up";
    if (this.cursors.down.isDown) return "down";
    return null;
  }

  private bindTouchControls(): void {
    const controls = this.hud.touchControls;
    if (!controls) return;
    const dirBtns = controls.querySelectorAll<HTMLButtonElement>("[data-action='up'],[data-action='down'],[data-action='left'],[data-action='right']");
    dirBtns.forEach((btn) => {
      const dir = btn.dataset.action as Direction;
      btn.addEventListener("pointerdown", (e) => { e.preventDefault(); this.activeTouchDirection = dir; btn.setPointerCapture?.(e.pointerId); });
      btn.addEventListener("pointerup", (e) => { e.preventDefault(); if (this.activeTouchDirection === dir) this.activeTouchDirection = null; });
      btn.addEventListener("pointercancel", () => { if (this.activeTouchDirection === dir) this.activeTouchDirection = null; });
    });
    controls.querySelector<HTMLButtonElement>("[data-action='bomb']")?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.model.snapshot().phase === "playing") this.model.plantBomb(0, this.time.now);
    });
  }

  private createBackground(): void {
    const g = this.add.graphics();
    g.fillStyle(0x050914, 1);
    g.fillRect(0, 0, this.scale.width, this.scale.height);
    g.lineStyle(1, 0x0e2534, 0.55);
    for (let x = 0; x <= this.scale.width; x += 16) g.lineBetween(x, 0, x, this.scale.height);
    for (let y = 0; y <= this.scale.height; y += 16) g.lineBetween(0, y, this.scale.width, y);
  }

  private createBoardBacking(): void {
    const t = this.TILE;
    const bx = this.BOARD_X;
    const by = this.BOARD_Y;
    const bw = LEVEL_WIDTH * t;
    const bh = LEVEL_HEIGHT * t;
    const g = this.add.graphics();
    g.fillStyle(0x07111c, 0.98);
    g.fillRoundedRect(bx - 8, by - 8, bw + 16, bh + 16, 4);
    g.lineStyle(1, 0x2be4ff, 0.28);
    g.strokeRoundedRect(bx - 14, by - 14, bw + 28, bh + 28, 4);
  }

  private createChrome(): void {
    const t = this.TILE;
    const bx = this.BOARD_X;
    const by = this.BOARD_Y;
    const bw = LEVEL_WIDTH * t;
    const bh = LEVEL_HEIGHT * t;
    const frame = this.add.graphics();
    frame.lineStyle(3, 0x35d9ff, 0.9);
    frame.strokeRoundedRect(bx - 8, by - 8, bw + 16, bh + 16, 4);
    frame.lineStyle(1, 0xff4d9d, 0.45);
    frame.strokeRoundedRect(bx - 2, by - 2, bw + 4, bh + 4, 2);
  }

  private render(snapshot: GameSnapshot): void {
    const t = this.TILE;
    this.board.setPosition(this.BOARD_X, this.BOARD_Y);

    // tiles: only redraw when a brick is destroyed (count changes).
    // Count with a plain loop to avoid allocating a flattened array every frame.
    let brickCount = 0;
    for (const row of snapshot.tiles) {
      for (const cell of row) if (cell === "brick") brickCount += 1;
    }
    if (brickCount !== this.lastBrickCount) {
      this.lastBrickCount = brickCount;
      this.drawTiles(snapshot, t);
    }

    // dynamic elements: clear once, draw all into gDynamic
    this.gDynamic.clear();
    this.drawPowerUps(snapshot, t);
    this.drawGems(snapshot, t);
    this.drawBombs(snapshot, t);
    this.drawExplosions(snapshot, t);

    this.drawEnemies(snapshot, t);
    snapshot.players.forEach((p) => this.drawPlayer(snapshot, p, t));

    if (snapshot.phase !== this.lastPhase) {
      if (snapshot.phase === "won") {
        const winner = snapshot.winnerIndex !== null ? `Người chơi ${snapshot.winnerIndex + 1}` : "Bạn";
        const score = snapshot.winnerIndex !== null ? snapshot.scores[snapshot.winnerIndex] : snapshot.scores[0];
        this.showStatus("HOÀN THÀNH", `${winner} thắng!`, `Điểm: ${score}. Bấm chơi lại để map mới.`, false);
      } else if (snapshot.phase === "lost") {
        this.showStatus("THẤT BẠI", "Thua rồi!", `${snapshot.message} Bấm chơi lại để thử.`, false);
      }
      this.lastPhase = snapshot.phase;
    }
  }

  private drawTiles(snapshot: GameSnapshot, t: number): void {
    if (!snapshot.tiles.length) return;
    const g = this.gTiles;
    g.clear();
    for (let y = 0; y < snapshot.height; y++) {
      for (let x = 0; x < snapshot.width; x++) {
        const px = x * t;
        const py = y * t;
        const alt = (x + y) % 2 === 0;
        g.fillStyle(alt ? COLORS.floor : COLORS.floorAlt, 1);
        g.fillRect(px, py, t, t);
        g.lineStyle(1, COLORS.grid, 0.28);
        g.strokeRect(px, py, t, t);
        const tile = snapshot.tiles[y][x];
        if (tile === "wall") {
          g.fillStyle(COLORS.wall, 1); g.fillRect(px + 4, py + 4, t - 8, t - 8);
          g.fillStyle(COLORS.wallTop, 1); g.fillRect(px + 8, py + 8, t - 16, 6);
          g.fillStyle(0x334254, 1); g.fillRect(px + 8, py + 26, t - 16, 4);
        } else if (tile === "brick") {
          g.fillStyle(COLORS.brick, 1); g.fillRect(px + 5, py + 6, t - 10, t - 12);
          g.fillStyle(COLORS.brickTop, 1); g.fillRect(px + 8, py + 9, t - 16, 5);
          g.fillStyle(0x562419, 1); g.fillRect(px + 8, py + 22, t - 16, 3);
        } else if (tile === "exit") {
          g.fillStyle(COLORS.exit, 0.25); g.fillRect(px + 5, py + 5, t - 10, t - 10);
          g.lineStyle(3, COLORS.exit, 1); g.strokeRect(px + 9, py + 9, t - 18, t - 18);
        }
      }
    }
  }

  private drawPowerUps(snapshot: GameSnapshot, t: number): void {
    const g = this.gDynamic;
    const half = Math.floor(t * 0.3);
    for (const pu of snapshot.powerUps) {
      if (snapshot.tiles[pu.cell.y][pu.cell.x] !== "floor") continue;
      const c = this.cellCenter(pu.cell, t);
      const label = pu.type === "bomb" ? "B" : pu.type === "range" ? "L" : "T";
      g.fillStyle(this.powerColor(pu.type), 1);
      g.fillRect(c.x - half, c.y - half, half * 2, half * 2);
      g.lineStyle(2, 0xffffff, 0.85);
      g.strokeRect(c.x - half, c.y - half, half * 2, half * 2);
      // draw letter via fillPoints (avoid text alloc — use small pixel rects)
      this.drawPixelLabel(g, c.x, c.y, label, t);
    }
  }

  private drawPixelLabel(g: Phaser.GameObjects.Graphics, cx: number, cy: number, label: string, t: number): void {
    const s = Math.max(2, Math.floor(t * 0.065));
    const color = 0xffffff;
    g.fillStyle(color, 1);
    if (label === "B") {
      g.fillRect(cx - s * 2, cy - s * 2, s, s * 4); g.fillRect(cx - s, cy - s * 2, s * 2, s);
      g.fillRect(cx - s, cy - s, s * 2, s); g.fillRect(cx - s, cy, s * 2, s);
    } else if (label === "L") {
      g.fillRect(cx - s * 2, cy - s * 2, s, s * 4); g.fillRect(cx - s, cy + s * 2, s * 2, s);
    } else {
      g.fillRect(cx - s * 2, cy - s * 2, s * 2, s); g.fillRect(cx - s * 2, cy, s * 4, s);
      g.fillRect(cx + s, cy - s * 2, s, s * 2);
    }
  }

  private drawGems(snapshot: GameSnapshot, t: number): void {
    const g = this.gDynamic;
    const r = Math.floor(t * 0.28);
    for (const gem of snapshot.gems) {
      if (snapshot.tiles[gem.cell.y][gem.cell.x] !== "floor") continue;
      const c = this.cellCenter(gem.cell, t);
      g.fillStyle(this.gemColor(gem.type), 0.9);
      g.fillTriangle(c.x, c.y - r, c.x - r, c.y + r, c.x + r, c.y + r);
      g.lineStyle(2, 0xffffff, 0.7);
      g.strokeTriangle(c.x, c.y - r, c.x - r, c.y + r, c.x + r, c.y + r);
    }
  }

  private drawBombs(snapshot: GameSnapshot, t: number): void {
    const g = this.gDynamic;
    for (const bomb of snapshot.bombs) {
      const c = this.cellCenter(bomb.cell, t);
      g.fillStyle(COLORS.bomb, 1); g.fillRect(c.x - 12, c.y - 7, 24, 19);
      g.fillStyle(0xeaf7ff, 1); g.fillRect(c.x - 7, c.y - 3, 5, 5);
      g.fillStyle(0xff4d9d, 1); g.fillRect(c.x + 8, c.y - 15, 5, 5);
    }
  }

  private drawExplosions(snapshot: GameSnapshot, t: number): void {
    const g = this.gDynamic;
    const hw = Math.floor(t * 0.45);
    const hh = Math.floor(t * 0.17);
    for (const exp of snapshot.explosions) {
      for (const cell of exp.cells) {
        const c = this.cellCenter(cell, t);
        g.fillStyle(COLORS.flameHot, 0.88);
        g.fillRect(c.x - hw, c.y - hh, hw * 2, hh * 2);
        g.fillRect(c.x - hh, c.y - hw, hh * 2, hw * 2);
        g.fillStyle(COLORS.flame, 0.95);
        g.fillRect(c.x - hh, c.y - hh, hh * 2, hh * 2);
      }
    }
  }

  private drawEnemies(snapshot: GameSnapshot, t: number): void {
    if (!snapshot.tiles.length) return;
    const enemyFrames = [64, 72, 80, 88];
    const scale = (t / 40) * 2;
    const g = this.gDynamic;
    const shadowW = Math.floor(t * 0.7);
    const shadowH = Math.floor(t * 0.2);
    const shadowOffY = Math.floor(t * 0.4);

    for (let i = 0; i < this.enemySprites.length; i++) {
      const enemy = snapshot.enemies[i];
      const sprite = this.enemySprites[i];
      if (enemy) {
        const target = this.cellCenter(enemy.cell, t);
        const c = this.smoothPos(`e${enemy.id}`, target.x, target.y, t);
        const hasShield = enemy.activeBuffs.some(
          (b) => b.type === "shield" && b.expiresAt > this.time.now
        );
        if (hasShield) {
          g.lineStyle(3, 0x06d6a0, 0.8);
          g.strokeCircle(c.x, c.y, t * 0.5);
        }
        g.fillStyle(0x000000, 0.38);
        g.fillEllipse(c.x, c.y + shadowOffY, shadowW, shadowH);
        sprite.setFrame(enemyFrames[i % enemyFrames.length]);
        sprite.setPosition(c.x, c.y + 1);
        sprite.setScale(scale);
        sprite.setOrigin(0.5, 0.55);
        sprite.setVisible(true);
      } else {
        sprite.setVisible(false);
      }
    }
  }

  private drawPlayer(snapshot: GameSnapshot, player: Player, t: number): void {
    const i = player.index;
    const sprite = this.playerSprites[i];
    const label = this.playerLabels[i];

    if (!snapshot.tiles.length || !player.alive) {
      sprite.setVisible(false); label.setVisible(false);
      return;
    }
    const flashing = player.invincibleUntil > this.time.now && Math.floor(this.time.now / 120) % 2 === 0;
    if (flashing) {
      sprite.setVisible(false); label.setVisible(false);
      return;
    }

    const target = this.cellCenter(player.cell, t);
    const c = this.smoothPos(`p${i}`, target.x, target.y, t);
    const g = this.gDynamic;

    const hasShield = player.activeBuffs.some(
      (b) => b.type === "shield" && b.expiresAt > this.time.now
    );
    if (hasShield) {
      g.lineStyle(3, 0x06d6a0, 0.8);
      g.strokeCircle(c.x, c.y, t * 0.5);
    }

    g.fillStyle(0x000000, 0.38);
    g.fillEllipse(c.x, c.y + Math.floor(t * 0.4), Math.floor(t * 0.7), Math.floor(t * 0.2));

    const character = CHARACTERS[player.character];
    sprite.setFrame(character.spriteFrame);
    sprite.setPosition(c.x, c.y + 1);
    sprite.setScale((t / 40) * 2.15);
    sprite.setOrigin(0.5, 0.55);
    sprite.setVisible(true);

    const prefix = snapshot.mode === "versus" ? `P${i + 1} ` : "";
    label.setText(`${prefix}HP ${player.lives}`);
    label.setFontSize(Math.max(9, Math.floor(t * 0.28)));
    label.setPosition(c.x, c.y - Math.floor(t * 0.7));
    label.setVisible(true);
  }

  private updateDom(snapshot: GameSnapshot): void {
    const p0 = snapshot.players[0];
    const p1 = snapshot.players[1];

    if (this.hud.score) this.hud.score.textContent = snapshot.scores[0].toString().padStart(4, "0");
    if (this.hud.time) this.hud.time.textContent = snapshot.timeLeft.toString();
    if (this.hud.enemies) this.hud.enemies.textContent = snapshot.enemies.length.toString();
    if (this.hud.difficulty) this.hud.difficulty.textContent = DIFFICULTIES[snapshot.difficulty].label.toUpperCase();
    if (this.hud.pause) this.hud.pause.textContent = snapshot.phase === "paused" ? ">" : "II";

    if (p0) {
      const active0 = snapshot.bombs.filter((b) => b.owner === "player0").length;
      if (this.hud.bombs) this.hud.bombs.textContent = `${Math.max(0, p0.maxBombs - active0)}/${p0.maxBombs}`;
      if (this.hud.range) this.hud.range.textContent = p0.bombRange.toString();
      if (this.hud.lives) this.hud.lives.textContent = p0.alive ? p0.lives.toString() : "✕";
    }

    if (p1 && snapshot.mode === "versus") {
      const active1 = snapshot.bombs.filter((b) => b.owner === "player1").length;
      if (this.hud.score2) this.hud.score2.textContent = snapshot.scores[1].toString().padStart(4, "0");
      if (this.hud.bombs2) this.hud.bombs2.textContent = `${Math.max(0, p1.maxBombs - active1)}/${p1.maxBombs}`;
      if (this.hud.range2) this.hud.range2.textContent = p1.bombRange.toString();
      if (this.hud.lives2) this.hud.lives2.textContent = p1.alive ? p1.lives.toString() : "✕";
    }
  }

  private cellCenter(cell: Vec2, t: number): Vec2 {
    return { x: cell.x * t + Math.floor(t / 2), y: cell.y * t + Math.floor(t / 2) };
  }

  private powerColor(type: PowerUpType): number {
    if (type === "bomb") return COLORS.bombPower;
    if (type === "range") return COLORS.range;
    return COLORS.speed;
  }

  private gemColor(type: BuffType): number {
    switch (type) {
      case "extraLife": return COLORS.gemExtraLife;
      case "phaseWalk": return COLORS.gemPhaseWalk;
      case "megaBlast": return COLORS.gemMegaBlast;
      case "speedSurge": return COLORS.gemSpeedSurge;
      case "shield": return COLORS.gemShield;
    }
  }
}
