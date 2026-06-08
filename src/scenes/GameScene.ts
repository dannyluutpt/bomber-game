import Phaser from "phaser";
import { CHARACTERS, DIFFICULTIES, GameModel } from "../simulation/GameModel";
import { LEVEL_HEIGHT, LEVEL_WIDTH } from "../simulation/level";
import { NetClient, type NetMessage, type NetRole } from "../net/NetClient";
import { THEMES, type MapTheme } from "../render/themes";
import type {
  BuffType,
  CharacterId,
  DifficultyId,
  Direction,
  GameMode,
  GameSnapshot,
  MapThemeId,
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

type MenuScreen = "main" | "guide" | "mode" | "online" | "create-room" | "join-room" | "difficulty" | "character" | "character-p2" | "map" | "status";

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
  private gemImages: Phaser.GameObjects.Image[] = [];
  private lastBrickCount = -1;
  private activeTouchDirection: Direction | null = null;
  private selectedDifficulty: DifficultyId = "normal";
  private selectedCharacters: [CharacterId, CharacterId] = ["nova", "orion"];
  private selectedMode: GameMode = "single";
  private selectedTheme: MapThemeId = "volcano";
  private lastSeed = 0;
  private hudOffset = 88;
  private touchBottom = 0;
  private lastLayoutCheck = 0;
  private bgGraphics?: Phaser.GameObjects.Graphics;
  private backingGraphics?: Phaser.GameObjects.Graphics;
  private chromeGraphics?: Phaser.GameObjects.Graphics;
  private stars?: { x: number; y: number; r: number; a: number }[];
  private boundDomKeydown = (e: KeyboardEvent) => this.handleDomKeydown(e);

  // --- Online multiplayer (host-authoritative over PeerJS) ---
  // host: owns the GameModel, applies remote input to player 1, broadcasts snapshots.
  // joiner: runs no simulation — renders host snapshots, streams its input to the host.
  private net: NetClient | null = null;
  private netRole: NetRole = "none";
  private latestSnapshot: GameSnapshot | null = null; // joiner: most recent host frame
  private remoteDir: Direction | null = null;         // host: joiner's held direction
  private remoteBombQueued = false;                    // host: joiner pressed bomb
  private lastSentDir: Direction | null = null;        // joiner: dedupe dir messages
  private myCharChosen = false;                         // online char-select lock
  private remoteChar: CharacterId | null = null;       // the other player's pick
  private snapAccumMs = 0;                              // host: snapshot send throttle
  private static readonly SNAP_INTERVAL_MS = 33;        // ~30 Hz broadcast

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

  private get theme(): MapTheme { return THEMES[this.selectedTheme]; }

  // Returns true if layout measurements changed (caller should redraw static layers).
  private refreshLayout(): boolean {
    const hud = document.getElementById("hud");
    const newHud = hud ? Math.ceil(hud.getBoundingClientRect().bottom) + 6 : this.hudOffset;

    // In landscape the controls are semi-transparent overlays — don't subtract them.
    const isLandscape = this.scale.width > this.scale.height;
    const tc = document.getElementById("touch-controls");
    let newTouch = 0;
    if (!isLandscape && tc && getComputedStyle(tc).display !== "none") {
      newTouch = Math.ceil(this.scale.height - tc.getBoundingClientRect().top) + 4;
    }

    const changed = newHud !== this.hudOffset || newTouch !== this.touchBottom;
    this.hudOffset = newHud;
    this.touchBottom = newTouch;
    if (changed) this.lastBrickCount = -1;
    return changed;
  }

  private redrawStaticLayers(): void {
    this.cameras.main.setBackgroundColor("#050914");
    this.createBackground();
    this.createBoardBacking();
    this.createChrome();
  }

  private get TILE(): number {
    const w = this.scale.width;
    const h = this.scale.height;
    return Math.min(
      Math.floor(w / LEVEL_WIDTH),
      Math.floor((h - this.hudOffset - this.touchBottom) / LEVEL_HEIGHT)
    );
  }
  private get BOARD_X(): number { return Math.floor((this.scale.width - LEVEL_WIDTH * this.TILE) / 2); }
  private get BOARD_Y(): number { return this.hudOffset; }

  preload(): void {
    this.load.spritesheet("rpgCharacters", `${import.meta.env.BASE_URL}assets/rpg_16x16.png`, {
      frameWidth: 16, frameHeight: 16
    });
    this.load.spritesheet("kenney1bit", `${import.meta.env.BASE_URL}assets/kenney_1bit_colored.png`, {
      frameWidth: 16, frameHeight: 16, spacing: 1
    });
  }

  create(): void {
    this.refreshLayout();
    this.cameras.main.setBackgroundColor("#050914");
    this.createBackground();
    this.createBoardBacking();
    this.board = this.add.container(this.BOARD_X, this.BOARD_Y);
    this.lastBrickCount = -1;
    this.createChrome();

    // --- persistent render pool: created once, reused every frame ---
    // Layer order: tiles → gem icons → dynamic vector (bombs/explosions) → enemies → players → labels
    this.gTiles = this.add.graphics();
    this.board.add(this.gTiles);

    // Gem sprite pool — sits above tiles but below explosions
    for (let i = 0; i < 16; i++) {
      const img = this.add.image(0, 0, "kenney1bit", 529);
      img.setVisible(false); this.board.add(img); this.gemImages.push(img);
    }

    this.gDynamic = this.add.graphics();  // power-ups + bombs + explosions + shields
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
      // Defer one animation frame so CSS has time to apply the new
      // orientation's media queries before we measure the HUD height.
      requestAnimationFrame(() => {
        this.refreshLayout();
        this.redrawStaticLayers();
      });
    });

    this.bindMenu();
    this.bindTouchControls();
    window.addEventListener("keydown", this.boundDomKeydown);

    this.showScreen("main");
    this.render(this.model.snapshot());
  }

  update(time: number, delta: number): void {
    this.frameDelta = delta;
    // Poll layout every 800 ms to catch orientation changes that the resize
    // event may have missed or measured too early.
    if (time - this.lastLayoutCheck > 800) {
      this.lastLayoutCheck = time;
      if (this.refreshLayout()) this.redrawStaticLayers();
    }

    // Joiner: no local simulation. Stream input to host, render host's last frame.
    if (this.netRole === "joiner") {
      this.handleJoinerInput(time);
      if (this.latestSnapshot) {
        this.render(this.latestSnapshot);
        this.updateDom(this.latestSnapshot);
      }
      return;
    }

    // Host / single player: run the authoritative simulation.
    this.handleInput(time);
    if (this.netRole === "host") this.applyRemoteInput(time);
    this.model.update(time, delta);
    const snapshot = this.model.snapshot();
    this.render(snapshot);
    this.updateDom(snapshot);
    if (this.netRole === "host") this.broadcastSnapshot(snapshot, delta);
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
    this.hud.backDifficulty?.addEventListener("click", () => {
      // In an online session the character screen sits after the room flow, not difficulty.
      if (this.netRole !== "none") { this.leaveNet(); this.showScreen("online"); return; }
      this.showScreen("difficulty");
    });
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
        // "versus" is now online-only: choose to create or join a room.
        this.showScreen(this.selectedMode === "versus" ? "online" : "difficulty");
      });
    });

    // --- Online room flow ---
    document.querySelector<HTMLButtonElement>("#create-room-button")
      ?.addEventListener("click", () => this.startHosting());
    document.querySelector<HTMLButtonElement>("#join-room-button")
      ?.addEventListener("click", () => {
        this.setJoinStatus("Nhập mã 6 số bạn nhận được.");
        this.showScreen("join-room");
      });
    document.querySelector<HTMLButtonElement>("#connect-room-button")
      ?.addEventListener("click", () => this.startJoining());
    document.querySelector<HTMLButtonElement>("#copy-code-button")
      ?.addEventListener("click", () => this.copyRoomCode());
    document.querySelectorAll<HTMLButtonElement>(".back-online-button").forEach((btn) => {
      btn.addEventListener("click", () => { this.leaveNet(); this.showScreen("online"); });
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
        // Online: this screen is shared by both peers; the click picks YOUR character.
        if (this.netRole !== "none") {
          this.handleOnlineCharPick(btn.dataset.characterP1 as CharacterId, btn);
          return;
        }
        this.selectedCharacters[0] = btn.dataset.characterP1 as CharacterId;
        this.markActive("[data-character-p1]", btn);
        // Single player: character → map select → start.
        this.showScreen("map");
      });
    });

    // --- Map / theme select ---
    document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedTheme = btn.dataset.theme as MapThemeId;
        this.markActive("[data-theme]", btn);
        if (this.netRole === "host") this.startOnlineMatchAsHost();
        else this.startGame();
      });
    });
    document.querySelector<HTMLButtonElement>("#back-map-button")?.addEventListener("click", () => {
      if (this.netRole === "host") {
        // let the host re-pick its character (which re-opens map select afterwards)
        this.myCharChosen = false;
        this.resetCharSelectUI();
        this.setCharSelectEyebrow("CHỌN NHÂN VẬT CỦA BẠN");
      }
      this.showScreen("character");
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
      btn.disabled = false;
      btn.classList.remove("taken");
    });
  }

  private markActive(selector: string, active: HTMLButtonElement): void {
    document.querySelectorAll(selector).forEach((btn) => btn.classList.remove("active"));
    active.classList.add("active");
  }

  private startGame(): void {
    this.lastBrickCount = -1;
    this.renderPos.clear();
    this.redrawStaticLayers(); // paint background/board in the chosen theme
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
    // Online: only the host restarts authoritatively; the joiner asks the host to.
    if (this.netRole === "host") { this.startOnlineMatchAsHost(); return; }
    if (this.netRole === "joiner") { this.net?.send({ t: "restart" }); return; }
    this.lastBrickCount = -1;
    this.renderPos.clear();
    this.redrawStaticLayers();
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
    if (this.netRole !== "none") { this.leaveNet(); this.showScreen("main"); return; }
    const snapshot = this.model.snapshot();
    if (snapshot.phase === "playing") this.model.setPaused(true);
    this.showScreen("main");
  }

  private togglePause(): void {
    // Pausing is disabled online — there is no clean way to pause both peers.
    if (this.netRole !== "none") return;
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
    if (this.hud.restart) this.hud.restart.style.display = "";
    this.showScreen("status");
  }

  private handleInput(time: number): void {
    // Read live model fields directly — no full snapshot deep-copy needed for input
    if (this.model.phase !== "playing") return;

    this.handlePlayerInput(0, time);
    // Local 2nd-player input only exists in legacy single-machine versus; online host
    // gets player 1's input from the network instead (see applyRemoteInput).
    if (this.model.mode === "versus" && this.netRole === "none") this.handlePlayerInput(1, time);
  }

  private handlePlayerInput(playerIndex: 0 | 1, time: number): void {
    const player = this.model.players[playerIndex];
    if (!player?.alive) return;

    const isSingle = this.model.mode === "single";
    // The host's local human owns player 0 with full controls (WASD + arrows + Space/Enter),
    // just like single player, since the joiner is a separate machine.
    const fullControls = isSingle || this.netRole === "host";

    if (playerIndex === 0) {
      const bomb = Phaser.Input.Keyboard.JustDown(this.keys.SPACE) ||
        (fullControls && Phaser.Input.Keyboard.JustDown(this.keys.ENTER));
      if (bomb) this.model.plantBomb(0, time);
    } else {
      if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) this.model.plantBomb(1, time);
    }

    if (time < this.moveCooldown[playerIndex]) return;

    const dir = playerIndex === 0
      ? this.readDirectionP1(fullControls)
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
      if (this.netRole === "joiner") {
        if (this.latestSnapshot?.phase === "playing") this.net?.send({ t: "bomb" });
      } else if (this.model.snapshot().phase === "playing") {
        this.model.plantBomb(0, this.time.now);
      }
    });
  }

  private createBackground(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const th = this.theme;
    if (!this.bgGraphics) this.bgGraphics = this.add.graphics();
    else this.bgGraphics.clear();
    const g = this.bgGraphics;

    // Vertical space gradient (top → bottom) sets the theme's overall mood.
    g.fillGradientStyle(th.bgTop, th.bgTop, th.bgBottom, th.bgBottom, 1);
    g.fillRect(0, 0, w, h);

    // Soft nebula glows — translucent ellipses fake a coloured cloud cheaply.
    g.fillStyle(th.nebula, 0.1);
    g.fillEllipse(w * 0.28, h * 0.32, w * 0.6, h * 0.55);
    g.fillStyle(th.nebula, 0.08);
    g.fillEllipse(w * 0.76, h * 0.72, w * 0.55, h * 0.5);

    // Starfield (positions stored in normalised coords so they stay put on resize).
    if (!this.stars) this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() < 0.2 ? 1.8 : 1, a: 0.35 + Math.random() * 0.5
    }));
    for (const s of this.stars) {
      g.fillStyle(th.star, s.a);
      g.fillCircle(s.x * w, s.y * h, s.r);
    }
  }

  private createBoardBacking(): void {
    const t = this.TILE;
    const bx = this.BOARD_X;
    const by = this.BOARD_Y;
    const bw = LEVEL_WIDTH * t;
    const bh = LEVEL_HEIGHT * t;
    const th = this.theme;
    if (!this.backingGraphics) this.backingGraphics = this.add.graphics();
    else this.backingGraphics.clear();
    this.backingGraphics.fillStyle(0x000000, 0.45);
    this.backingGraphics.fillRoundedRect(bx - 8, by - 8, bw + 16, bh + 16, 6);
    this.backingGraphics.lineStyle(1, th.accentSoft, 0.28);
    this.backingGraphics.strokeRoundedRect(bx - 14, by - 14, bw + 28, bh + 28, 6);
  }

  private createChrome(): void {
    const t = this.TILE;
    const bx = this.BOARD_X;
    const by = this.BOARD_Y;
    const bw = LEVEL_WIDTH * t;
    const bh = LEVEL_HEIGHT * t;
    const th = this.theme;
    if (!this.chromeGraphics) this.chromeGraphics = this.add.graphics();
    else this.chromeGraphics.clear();
    this.chromeGraphics.lineStyle(3, th.accent, 0.9);
    this.chromeGraphics.strokeRoundedRect(bx - 8, by - 8, bw + 16, bh + 16, 6);
    this.chromeGraphics.lineStyle(1, th.accentSoft, 0.5);
    this.chromeGraphics.strokeRoundedRect(bx - 2, by - 2, bw + 4, bh + 4, 3);
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
    const th = this.theme;
    const g = this.gTiles;
    g.clear();
    for (let y = 0; y < snapshot.height; y++) {
      for (let x = 0; x < snapshot.width; x++) {
        const px = x * t;
        const py = y * t;
        const alt = (x + y) % 2 === 0;
        g.fillStyle(alt ? th.floor : th.floorAlt, 1);
        g.fillRect(px, py, t, t);
        g.lineStyle(1, th.grid, 0.3);
        g.strokeRect(px, py, t, t);
        const tile = snapshot.tiles[y][x];
        if (tile === "wall") {
          this.drawBlock(g, px, py, t, false);
        } else if (tile === "brick") {
          this.drawBlock(g, px, py, t, true);
        } else if (tile === "exit") {
          g.fillStyle(th.accent, 0.22); g.fillRect(px + 5, py + 5, t - 10, t - 10);
          g.lineStyle(3, th.accent, 1); g.strokeRect(px + 9, py + 9, t - 18, t - 18);
        } else {
          this.drawFloorMotif(g, px, py, t, x, y);
        }
      }
    }
  }

  // Sparse, deterministic biome flecks on empty floor (embers / frost / leaves).
  private drawFloorMotif(g: Phaser.GameObjects.Graphics, px: number, py: number, t: number, x: number, y: number): void {
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    if ((h & 7) !== 0) return; // ~1 in 8 cells
    const cx = px + t * (0.25 + ((h >> 3) & 3) * 0.16);
    const cy = py + t * (0.25 + ((h >> 5) & 3) * 0.16);
    const r = Math.max(1, t * 0.035);
    const th = this.theme;
    if (th.kind === "ice") { g.fillStyle(0xffffff, 0.22); g.fillRect(cx, cy, r * 1.6, 1); }
    else { g.fillStyle(th.detail, th.kind === "volcano" ? 0.5 : 0.4); g.fillCircle(cx, cy, r); }
  }

  // A faux-3D block (shadow + side + body + lit top + bevel) with a biome motif
  // drawn on its face: lava cracks (volcano), an icy shine (ice), wood/moss (jungle).
  private drawBlock(g: Phaser.GameObjects.Graphics, px: number, py: number, t: number, isBrick: boolean): void {
    const th = this.theme;
    const base = isBrick ? th.brick : th.wall;
    const top = isBrick ? th.brickTop : th.wallTop;
    const side = isBrick ? th.brickSide : th.wallSide;
    const inset = Math.max(2, Math.floor(t * 0.09));
    const w = t - inset * 2;
    const lift = Math.max(2, Math.floor(t * 0.16)); // apparent block height
    const bx = px + inset;
    const by = py + inset;
    const fh = w - lift; // visible body-face height

    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(px + t / 2, py + t - inset * 0.5, w * 0.96, Math.max(3, inset * 1.5));
    g.fillStyle(side, 1);
    g.fillRect(bx, by, w, w);
    g.fillStyle(base, 1);
    g.fillRect(bx, by, w, fh);
    g.fillStyle(top, 1);
    g.fillRect(bx + Math.floor(w * 0.12), by + Math.floor(w * 0.1), Math.floor(w * 0.76), Math.max(3, Math.floor(t * 0.13)));
    g.fillStyle(top, 0.3);
    g.fillRect(bx, by, Math.max(2, Math.floor(t * 0.06)), fh);

    this.drawBlockMotif(g, bx, by, w, fh, t, isBrick);
  }

  private drawBlockMotif(g: Phaser.GameObjects.Graphics, bx: number, by: number, w: number, fh: number, t: number, isBrick: boolean): void {
    const th = this.theme;
    if (th.kind === "volcano") {
      if (!isBrick) return; // only breakable rock glows with magma
      g.lineStyle(Math.max(1, t * 0.05), th.detail, 0.95);
      g.beginPath();
      g.moveTo(bx + w * 0.28, by + fh * 0.15);
      g.lineTo(bx + w * 0.46, by + fh * 0.45);
      g.lineTo(bx + w * 0.34, by + fh * 0.68);
      g.lineTo(bx + w * 0.55, by + fh * 0.95);
      g.strokePath();
      g.fillStyle(th.detail, 0.9);
      g.fillCircle(bx + w * 0.72, by + fh * 0.4, Math.max(1, t * 0.05));
    } else if (th.kind === "ice") {
      g.fillStyle(0xffffff, isBrick ? 0.55 : 0.4); // diagonal shine streak
      g.fillRect(bx + w * 0.16, by + fh * 0.12, Math.max(2, Math.floor(t * 0.08)), Math.max(2, fh * 0.55));
    } else { // jungle
      if (isBrick) { // wood-grain lines on the crate
        g.lineStyle(Math.max(1, Math.floor(t * 0.03)), th.brickSide, 0.7);
        g.lineBetween(bx + w * 0.2, by + fh * 0.38, bx + w * 0.8, by + fh * 0.38);
        g.lineBetween(bx + w * 0.2, by + fh * 0.66, bx + w * 0.8, by + fh * 0.66);
      } else { // moss tufts on stone
        g.fillStyle(th.detail, 0.75);
        g.fillCircle(bx + w * 0.3, by + fh * 0.32, Math.max(1, t * 0.06));
        g.fillCircle(bx + w * 0.62, by + fh * 0.6, Math.max(1, t * 0.05));
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
    // Frame indices in kenney_1bit_colored.png (49 cols/row, spacing=1):
    // row*49+col — extraLife(10,39)=529, phaseWalk(10,33)=523, megaBlast(10,15)=505,
    //              speedSurge(10,32)=522, shield(4,37)=233
    const FRAMES: Record<BuffType, number> = {
      extraLife: 529, phaseWalk: 523, megaBlast: 505, speedSurge: 522, shield: 233
    };
    const scale = t / 16;
    let slot = 0;
    for (const gem of snapshot.gems) {
      if (snapshot.tiles[gem.cell.y][gem.cell.x] !== "floor") continue;
      if (slot >= this.gemImages.length) break;
      const c = this.cellCenter(gem.cell, t);
      this.gemImages[slot].setVisible(true).setPosition(c.x, c.y).setFrame(FRAMES[gem.type]).setScale(scale);
      slot++;
    }
    for (; slot < this.gemImages.length; slot++) {
      this.gemImages[slot].setVisible(false);
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
        sprite.setFrame(CHARACTERS[enemy.character].spriteFrame);
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

  // ===========================================================================
  //  Online multiplayer (PeerJS, host-authoritative)
  // ===========================================================================

  private setupNet(): void {
    this.net?.destroy();
    this.net = new NetClient();
    this.net.onPeerConnect = () => this.onPeerConnected();
    this.net.onPeerClose = () => this.onPeerClosed();
    this.net.onError = (reason) => this.onNetError(reason);
    this.net.onMessage = (msg) => this.onNetMessage(msg);
  }

  private async startHosting(): Promise<void> {
    this.setupNet();
    this.netRole = "host";
    this.setRoomCodeDisplay("······");
    this.setCreateStatus("Đang tạo phòng…");
    this.showScreen("create-room");
    try {
      const code = await this.net!.host();
      this.setRoomCodeDisplay(code);
      this.setCreateStatus("Đang chờ người chơi 2 kết nối…");
    } catch {
      this.setCreateStatus("Không tạo được phòng. Bấm Hủy rồi thử lại.");
    }
  }

  private async startJoining(): Promise<void> {
    const input = document.querySelector<HTMLInputElement>("#room-code-input");
    const code = (input?.value ?? "").replace(/\D/g, "");
    if (code.length !== 6) { this.setJoinStatus("Mã phải gồm đúng 6 chữ số."); return; }

    this.setupNet();
    this.netRole = "joiner";
    this.setJoinStatus("Đang kết nối…");
    try {
      await this.net!.join(code);
      // onPeerConnected() advances both peers to character select.
    } catch {
      // The human-readable reason was already shown via onNetError().
      this.net?.destroy();
      this.net = null;
      this.netRole = "none";
    }
  }

  private copyRoomCode(): void {
    const code = this.net?.code;
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => this.setCreateStatus(`Đã sao chép mã ${code}. Gửi cho bạn nhé!`),
      () => { /* clipboard blocked — user can still read the code */ }
    );
  }

  private leaveNet(): void {
    this.net?.destroy();
    this.net = null;
    this.netRole = "none";
    this.latestSnapshot = null;
    this.remoteDir = null;
    this.remoteBombQueued = false;
    this.lastSentDir = null;
    this.myCharChosen = false;
    this.remoteChar = null;
  }

  private onPeerConnected(): void {
    // Both peers are linked — jump straight into character select (no lobby).
    this.myCharChosen = false;
    this.remoteChar = null;
    this.selectedMode = "versus";
    this.resetCharSelectUI();
    this.setCharSelectEyebrow("CHỌN NHÂN VẬT CỦA BẠN");
    this.showScreen("character");
  }

  private onPeerClosed(): void {
    if (this.netRole === "none") return;
    this.net?.destroy();
    this.net = null;
    this.netRole = "none";
    this.showStatus("MẤT KẾT NỐI", "Đối thủ đã rời", "Quay lại menu chính để chơi tiếp.", false);
    if (this.hud.restart) this.hud.restart.style.display = "none";
  }

  private onNetError(reason: string): void {
    if (this.netRole === "joiner") this.setJoinStatus(reason);
    else this.setCreateStatus(reason);
  }

  private onNetMessage(msg: NetMessage): void {
    switch (msg.t) {
      case "char": {
        this.remoteChar = msg.id;
        const otherIndex = this.netRole === "host" ? 1 : 0;
        this.selectedCharacters[otherIndex] = msg.id;
        if (this.netRole === "host") this.maybeStartOnline();
        // Joiner: once both have picked, the host is choosing the map.
        else if (this.myCharChosen) this.setCharSelectEyebrow("CHỜ CHỦ PHÒNG CHỌN MAP…");
        break;
      }
      case "start":
        // Joiner adopts the host's authoritative match parameters (incl. theme).
        this.selectedCharacters = [...msg.characters];
        this.selectedDifficulty = msg.difficulty;
        this.selectedTheme = msg.theme;
        this.beginOnlineMatchAsJoiner();
        break;
      case "snap":
        this.latestSnapshot = msg.s;
        break;
      case "dir":
        this.remoteDir = msg.dir;
        break;
      case "bomb":
        this.remoteBombQueued = true;
        break;
      case "restart":
        if (this.netRole === "host") this.startOnlineMatchAsHost();
        break;
    }
  }

  private handleOnlineCharPick(id: CharacterId, btn: HTMLButtonElement): void {
    if (this.myCharChosen) return;
    this.myCharChosen = true;
    this.markActive("[data-character-p1]", btn);
    const myIndex = this.netRole === "host" ? 0 : 1;
    this.selectedCharacters[myIndex] = id;
    this.net?.send({ t: "char", id });
    this.setCharSelectEyebrow("ĐÃ CHỌN — CHỜ ĐỐI THỦ…");
    if (this.netRole === "host") this.maybeStartOnline();
  }

  // Host only: once both characters are locked, the host picks the map, then starts.
  private maybeStartOnline(): void {
    if (this.netRole !== "host") return;
    if (!this.myCharChosen || this.remoteChar === null) return;
    this.showScreen("map");
  }

  private startOnlineMatchAsHost(): void {
    const seed = this.nextSeed();
    const difficulty = this.selectedDifficulty;
    const characters: [CharacterId, CharacterId] = [...this.selectedCharacters];
    this.net?.send({ t: "start", seed, difficulty, characters, theme: this.selectedTheme });
    this.prepareOnlineRender();
    this.model.start({
      difficulty,
      characters: [...characters],
      mode: "versus",
      seed,
      now: this.time.now
    });
    this.lastPhase = "playing";
    this.hideOverlay();
  }

  private beginOnlineMatchAsJoiner(): void {
    this.latestSnapshot = null;
    this.lastSentDir = null;
    this.prepareOnlineRender();
    this.lastPhase = "playing";
    this.hideOverlay();
  }

  // Reset the renderer/network buffers shared by both roles at match start.
  private prepareOnlineRender(): void {
    this.selectedMode = "versus";
    this.lastBrickCount = -1;
    this.renderPos.clear();
    this.remoteDir = null;
    this.remoteBombQueued = false;
    this.snapAccumMs = 0;
    this.redrawStaticLayers(); // repaint background/board in the chosen theme
    if (this.hud.p2strip) this.hud.p2strip.style.display = "";
  }

  // Host: feed the joiner's streamed input into player 1, reusing the same
  // cooldown-gated stepping the local players use.
  private applyRemoteInput(time: number): void {
    if (this.model.phase !== "playing") return;
    const p1 = this.model.players[1];
    if (!p1?.alive) { this.remoteBombQueued = false; return; }

    if (this.remoteBombQueued) {
      this.model.plantBomb(1, time);
      this.remoteBombQueued = false;
    }
    if (time < this.moveCooldown[1]) return;
    if (!this.remoteDir) return;
    if (this.model.movePlayer(1, this.remoteDir, time)) {
      const spd = this.model.getEffectiveSpeed(1);
      this.moveCooldown[1] = time + Math.max(75, 170 - spd * 25);
    }
  }

  // Joiner: read local controls and stream them to the host (edge-based to keep
  // the channel quiet — only send when the held direction actually changes).
  private handleJoinerInput(_time: number): void {
    if (!this.net) return;
    if (this.latestSnapshot?.phase !== "playing") return;

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) ||
        Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) {
      this.net.send({ t: "bomb" });
    }
    const dir = this.readAnyDirection();
    if (dir !== this.lastSentDir) {
      this.lastSentDir = dir;
      this.net.send({ t: "dir", dir });
    }
  }

  private readAnyDirection(): Direction | null {
    if (this.keys.A.isDown || this.cursors.left.isDown) return "left";
    if (this.keys.D.isDown || this.cursors.right.isDown) return "right";
    if (this.keys.W.isDown || this.cursors.up.isDown) return "up";
    if (this.keys.S.isDown || this.cursors.down.isDown) return "down";
    return this.activeTouchDirection;
  }

  private broadcastSnapshot(snapshot: GameSnapshot, delta: number): void {
    this.snapAccumMs += delta;
    if (this.snapAccumMs < GameScene.SNAP_INTERVAL_MS) return;
    this.snapAccumMs = 0;
    this.net?.send({ t: "snap", s: snapshot });
  }

  // --- Online UI helpers ---
  private setRoomCodeDisplay(text: string): void {
    const el = document.querySelector<HTMLElement>("#room-code-display");
    if (el) el.textContent = text;
  }
  private setCreateStatus(text: string): void {
    const el = document.querySelector<HTMLElement>("#create-room-status");
    if (el) el.textContent = text;
  }
  private setJoinStatus(text: string): void {
    const el = document.querySelector<HTMLElement>("#join-room-status");
    if (el) el.textContent = text;
  }
  private setCharSelectEyebrow(text: string): void {
    const el = document.querySelector<HTMLElement>('[data-screen="character"] .eyebrow');
    if (el) el.textContent = text;
  }
  private resetCharSelectUI(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-character-p1]").forEach((btn) => {
      btn.classList.remove("active", "taken");
      btn.disabled = false;
    });
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
