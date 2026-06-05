import { createLevel, ENEMY_SPAWNS, LEVEL_HEIGHT, LEVEL_WIDTH, PLAYER_SPAWNS } from "./level";
import type {
  ActiveBuff,
  Bomb,
  BombOwner,
  BuffType,
  CharacterConfig,
  CharacterId,
  DifficultyConfig,
  DifficultyId,
  Direction,
  Enemy,
  Explosion,
  GameMode,
  GamePhase,
  GameSnapshot,
  Gem,
  Player,
  PowerUp,
  Tile,
  Vec2
} from "./types";

export const DIFFICULTIES: Record<DifficultyId, DifficultyConfig> = {
  easy: { id: "easy", label: "Dễ", timeLimit: 210, enemyCount: 2, enemyStepMs: 720, brickRate: 0.48, lives: 4 },
  normal: { id: "normal", label: "Thường", timeLimit: 180, enemyCount: 3, enemyStepMs: 600, brickRate: 0.56, lives: 3 },
  hard: { id: "hard", label: "Khó", timeLimit: 150, enemyCount: 4, enemyStepMs: 470, brickRate: 0.63, lives: 2 }
};

export const CHARACTERS: Record<CharacterId, CharacterConfig> = {
  nova: {
    id: "nova", name: "Nova", color: 0x4cc9f0, accent: 0xf8f4df,
    bonus: "speed", spriteFrame: 8, description: "Tốc độ gấp đôi."
  },
  orion: {
    id: "orion", name: "Orion", color: 0x80ed99, accent: 0x293241,
    bonus: "range", spriteFrame: 76, description: "Tầm nổ ban đầu +1."
  },
  titan: {
    id: "titan", name: "Titan", color: 0xf4a261, accent: 0x1a1a2e,
    bonus: "tank", spriteFrame: 0, description: "5 mạng, chậm hơn."
  },
  ghost: {
    id: "ghost", name: "Ghost", color: 0xb5a8d5, accent: 0x0d0d1a,
    bonus: "guardian", spriteFrame: 68, description: "Bất tử 4 giây sau khi bị đánh."
  },
  echo: {
    id: "echo", name: "Echo", color: 0xff6b6b, accent: 0x1a0a0a,
    bonus: "multibomb", spriteFrame: 12, description: "Bắt đầu với 3 bom tối đa."
  },
  viper: {
    id: "viper", name: "Viper", color: 0x06d6a0, accent: 0x0a1a12,
    bonus: "antichain", spriteFrame: 4, description: "Bom của Viper miễn nhiễm nổ dây chuyền."
  }
};

const DIRS: Record<Direction, Vec2> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
};
const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

const GEM_DROP_CHANCE = 0.25;
const GEM_TYPES: BuffType[] = ["extraLife", "phaseWalk", "megaBlast", "speedSurge", "shield"];

function sameCell(a: Vec2, b: Vec2): boolean { return a.x === b.x && a.y === b.y; }
function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
function manhattan(a: Vec2, b: Vec2): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

export class GameModel {
  phase: GamePhase = "ready";
  width = LEVEL_WIDTH;
  height = LEVEL_HEIGHT;
  difficulty: DifficultyId = "normal";
  mode: GameMode = "single";
  tiles: Tile[][] = [];
  players: Player[] = [];
  enemies: Enemy[] = [];
  bombs: Bomb[] = [];
  explosions: Explosion[] = [];
  powerUps: PowerUp[] = [];
  gems: Gem[] = [];
  scores: [number, number] = [0, 0];
  timeLeft = 180;
  exitOpen = false;
  message = "Sẵn sàng đặt bom";
  winnerIndex: number | null = null;

  private exitCell: Vec2 = { x: 1, y: 1 };
  private nextId = 1;
  private lastSecondAt = 0;
  private seed = 7331;
  private selectedCharacters: CharacterId[] = ["nova", "nova"];
  private phaserNow = 0;

  start(options: {
    difficulty?: DifficultyId;
    characters?: CharacterId[];
    mode?: GameMode;
    seed?: number;
    now?: number;
  } = {}): void {
    const difficulty = DIFFICULTIES[options.difficulty ?? this.difficulty];
    this.difficulty = difficulty.id;
    this.mode = options.mode ?? this.mode;
    this.selectedCharacters = options.characters ?? this.selectedCharacters;
    const seed = options.seed ?? Date.now() % 99999;
    this.seed = seed;
    // Anchor all enemy timers to the real match-start time (Phaser's clock keeps
    // running through the menus, so absolute small values would already be "due")
    this.phaserNow = options.now ?? this.phaserNow;

    const level = createLevel(seed, difficulty.brickRate);
    this.nextId = 1;
    this.phase = "playing";
    this.tiles = level.tiles;
    this.powerUps = level.powerUps;
    this.exitCell = level.exitCell;
    this.players = this.createPlayers();
    this.enemies = this.createEnemies();
    this.bombs = [];
    this.explosions = [];
    this.gems = [];
    this.scores = [0, 0];
    this.timeLeft = difficulty.timeLimit;
    this.exitOpen = false;
    this.winnerIndex = null;
    this.message = "Phá gạch để tìm cổng thoát";
    this.lastSecondAt = 0;
  }

  restart(): void {
    this.start({
      difficulty: this.difficulty,
      characters: this.selectedCharacters,
      mode: this.mode,
      seed: this.seed + 101
    });
  }

  setPaused(paused: boolean): void {
    if (this.phase === "playing" && paused) {
      this.phase = "paused";
      this.message = "Tạm dừng";
    } else if (this.phase === "paused" && !paused) {
      this.phase = "playing";
      this.message = "Tiếp tục";
    }
  }

  movePlayer(playerIndex: 0 | 1, direction: Direction, now: number): boolean {
    if (this.phase !== "playing") return false;
    this.phaserNow = now;
    const player = this.players[playerIndex];
    if (!player?.alive) return false;

    const next = add(player.cell, DIRS[direction]);
    if (!this.canOccupy(next, playerIndex)) return false;

    player.cell = next;
    this.pickPowerUp(playerIndex, next);
    this.pickGem(playerIndex, next);

    if (this.mode === "single" && this.exitOpen && sameCell(next, this.exitCell)) {
      this.phase = "won";
      this.winnerIndex = playerIndex;
      this.scores[playerIndex] += 1000 + this.timeLeft * 5;
      this.message = "Bạn đã thoát khỏi mê cung!";
    }

    this.checkAllPlayerHazards(now);
    return true;
  }

  plantBomb(playerIndex: 0 | 1, now: number): boolean {
    if (this.phase !== "playing") return false;
    this.phaserNow = now;
    const player = this.players[playerIndex];
    if (!player?.alive) return false;

    const ownerKey = `player${playerIndex}` as BombOwner;
    const activeBombs = this.bombs.filter((b) => b.owner === ownerKey).length;
    if (activeBombs >= player.maxBombs) {
      this.message = "Đã dùng hết bom";
      return false;
    }
    if (this.bombs.some((b) => sameCell(b.cell, player.cell))) return false;

    const megaBuff = player.activeBuffs.find((b) => b.type === "megaBlast" && b.usesLeft > 0);
    const range = megaBuff ? player.bombRange + 3 : player.bombRange;
    if (megaBuff) {
      megaBuff.usesLeft -= 1;
      if (megaBuff.usesLeft <= 0) {
        player.activeBuffs = player.activeBuffs.filter((b) => b !== megaBuff);
      }
    }

    this.bombs.push({
      id: this.nextId++,
      cell: { ...player.cell },
      owner: ownerKey,
      ownerCharacter: player.character,
      range,
      plantedAt: now,
      explodesAt: now + 2000
    });
    this.message = "Chạy!";
    return true;
  }

  getEffectiveSpeed(playerIndex: 0 | 1): number {
    const player = this.players[playerIndex];
    if (!player) return 1;
    if (this.hasActiveBuff(player, "speedSurge")) return 4;
    return player.speed;
  }

  update(now: number, delta: number): void {
    if (this.phase !== "playing") return;
    this.phaserNow = now;

    if (this.lastSecondAt === 0) this.lastSecondAt = now;
    if (now - this.lastSecondAt >= 1000) {
      const seconds = Math.floor((now - this.lastSecondAt) / 1000);
      this.timeLeft = Math.max(0, this.timeLeft - seconds);
      this.lastSecondAt += seconds * 1000;
      if (this.timeLeft <= 0) {
        this.phase = "lost";
        this.winnerIndex = null;
        this.message = "Hết giờ!";
        return;
      }
    }

    this.tickBuffs(now);
    this.moveEnemies(now, delta);
    this.resolveBombs(now);
    this.explosions = this.explosions.filter((e) => e.endsAt > now);
    this.checkAllPlayerHazards(now);

    if (this.phase !== "playing") return;

    const aliveCount = this.players.filter((p) => p.alive).length;

    // Exit gate is a single-player objective only. In versus the win condition is
    // last-player-standing, so no gate is created (it would just confuse players).
    if (this.mode === "single" && !this.exitOpen && this.enemies.length === 0) {
      this.exitOpen = true;
      this.tiles[this.exitCell.y][this.exitCell.x] = "exit";
      this.message = "Cổng thoát đã mở!";
      this.scores[0] += 250;
    }

    if (this.mode === "versus") {
      // Pure last-man-standing: the moment one player is eliminated, the other
      // wins — regardless of any remaining NPC monsters.
      if (aliveCount === 0) {
        this.phase = "lost";
        this.winnerIndex = null;
        this.message = "Cả hai cùng bị hạ!";
      } else if (aliveCount === 1) {
        const winner = this.players.find((p) => p.alive)!;
        this.phase = "won";
        this.winnerIndex = winner.index;
        this.message = `Người chơi ${winner.index + 1} thắng!`;
      }
    } else if (aliveCount === 0) {
      this.phase = "lost";
      this.winnerIndex = null;
      this.message = "Bạn đã bị hạ gục!";
    }
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      width: this.width,
      height: this.height,
      tiles: this.tiles.map((row) => [...row]),
      players: this.players.map((p) => ({
        ...p,
        cell: { ...p.cell },
        activeBuffs: p.activeBuffs.map((b) => ({ ...b }))
      })),
      enemies: this.enemies.map((e) => ({ ...e, cell: { ...e.cell } })),
      bombs: this.bombs.map((b) => ({ ...b, cell: { ...b.cell } })),
      explosions: this.explosions.map((e) => ({ ...e, cells: e.cells.map((c) => ({ ...c })) })),
      powerUps: this.powerUps.map((p) => ({ ...p, cell: { ...p.cell } })),
      gems: this.gems.map((g) => ({ ...g, cell: { ...g.cell } })),
      scores: [...this.scores] as [number, number],
      timeLeft: this.timeLeft,
      exitOpen: this.exitOpen,
      message: this.message,
      difficulty: this.difficulty,
      mode: this.mode,
      winnerIndex: this.winnerIndex
    };
  }

  private createPlayers(): Player[] {
    const difficulty = DIFFICULTIES[this.difficulty];
    const playerCount = this.mode === "versus" ? 2 : 1;
    return Array.from({ length: playerCount }, (_, i) => {
      const character = CHARACTERS[this.selectedCharacters[i] ?? "nova"];
      const player: Player = {
        index: i as 0 | 1,
        cell: { ...PLAYER_SPAWNS[i] },
        lives: character.bonus === "tank" ? 5 : difficulty.lives,
        maxBombs: character.bonus === "multibomb" ? 3 : 2,
        bombRange: character.bonus === "range" ? 3 : 2,
        speed: character.bonus === "speed" ? 2 : character.bonus === "tank" ? 0 : 1,
        invincibleUntil: 0,
        character: character.id,
        activeBuffs: [],
        alive: true
      };
      return player;
    });
  }

  private createEnemies(): Enemy[] {
    const difficulty = DIFFICULTIES[this.difficulty];
    return ENEMY_SPAWNS
      .filter((cell) => this.tiles[cell.y]?.[cell.x] === "floor")
      .slice(0, difficulty.enemyCount)
      .map((cell, index) => ({
        id: this.nextId++,
        cell: { ...cell },
        direction: DIRECTIONS[index % DIRECTIONS.length],
        nextMoveAt: this.phaserNow + 400 + index * 180,
        maxBombs: 2,
        bombRange: 2,
        speed: 1,
        activeBuffs: [],
        // grace period before first bomb, relative to real match start
        nextBombAt: this.phaserNow + 3500 + index * 1200
      }));
  }

  private canOccupy(cell: Vec2, forPlayerIndex?: 0 | 1): boolean {
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.width || cell.y >= this.height) return false;
    const tile = this.tiles[cell.y][cell.x];
    if (tile === "wall") return false;
    if (tile === "brick") {
      if (forPlayerIndex === undefined) return false;
      const player = this.players[forPlayerIndex];
      if (!this.hasActiveBuff(player, "phaseWalk")) return false;
    }
    if (this.bombs.some((bomb) => sameCell(bomb.cell, cell))) return false;
    return true;
  }

  private canEnemyOccupy(cell: Vec2, enemy?: Enemy): boolean {
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.width || cell.y >= this.height) return false;
    const tile = this.tiles[cell.y][cell.x];
    if (tile === "wall") return false;
    if (tile === "brick") {
      // bricks are passable only while phaseWalk is active for this enemy
      if (!enemy || !this.hasActiveBuff(enemy, "phaseWalk")) return false;
    }
    if (this.bombs.some((bomb) => sameCell(bomb.cell, cell))) return false;
    return true;
  }

  private moveEnemies(now: number, _delta: number): void {
    for (const enemy of this.enemies) {
      // expire buffs; if phaseWalk just wore off while inside a brick, eject the enemy
      const phaseExpiring = enemy.activeBuffs.some(
        (b) => b.type === "phaseWalk" && b.expiresAt > 0 && b.expiresAt <= now
      );
      enemy.activeBuffs = enemy.activeBuffs.filter(
        (b) => b.usesLeft > 0 || (b.expiresAt > 0 && b.expiresAt > now)
      );
      if (phaseExpiring) this.pushEnemyOutOfWall(enemy);

      if (now >= enemy.nextBombAt) {
        this.tryEnemyPlantBomb(enemy, now);
      }

      if (now < enemy.nextMoveAt) continue;

      const dir = this.getEnemyMoveDirection(enemy);
      if (dir) {
        enemy.direction = dir;
        enemy.cell = add(enemy.cell, DIRS[dir]);
        this.enemyPickup(enemy);
      }
      const effSpeed = this.hasActiveBuff(enemy, "speedSurge") ? 4 : enemy.speed;
      const stepMs = Math.max(160, DIFFICULTIES[this.difficulty].enemyStepMs - effSpeed * 55);
      enemy.nextMoveAt = now + stepMs;
    }
  }

  private getEnemyMoveDirection(enemy: Enemy): Direction | null {
    // Priority 1: flee from active bomb blast zones
    const inBlast = this.bombs.some((b) => {
      const dx = Math.abs(b.cell.x - enemy.cell.x);
      const dy = Math.abs(b.cell.y - enemy.cell.y);
      return (dx === 0 && dy <= b.range) || (dy === 0 && dx <= b.range);
    });
    if (inBlast) {
      const fleeDir = this.getFleeFromBombsDirection(enemy);
      if (fleeDir) return fleeDir;
    }

    const playerTargets = this.playerCellKeys();
    const chase = this.bfsFirstStep(enemy, false, playerTargets);

    // Priority 2: when safe, grab a nearby item if it is closer than the player
    // (acts like a human player farming power-ups/gems instead of charging blindly)
    const itemTargets = this.itemCellKeys();
    if (itemTargets.size > 0) {
      const item = this.bfsFirstStep(enemy, false, itemTargets);
      if (item.dir && item.dist <= 6 && item.dist <= chase.dist) {
        return item.dir;
      }
    }

    // Priority 3: hunt nearest alive player along the shortest OPEN path (bricks block)
    if (chase.dir) return chase.dir;

    // Priority 4: no open path — wander (digging through bricks is handled by bombs)
    if (this.canEnemyOccupy(add(enemy.cell, DIRS[enemy.direction]), enemy)) return enemy.direction;
    const shuffled = [...DIRECTIONS].sort(() => Math.random() - 0.5);
    for (const d of shuffled) {
      if (this.canEnemyOccupy(add(enemy.cell, DIRS[d]), enemy)) return d;
    }
    return null;
  }

  private playerCellKeys(): Set<string> {
    return new Set(
      this.players.filter((p) => p.alive).map((p) => `${p.cell.x},${p.cell.y}`)
    );
  }

  // Reachable item cells the enemy would benefit from (extraLife is skipped — enemies keep 1 life)
  private itemCellKeys(): Set<string> {
    const keys = new Set<string>();
    for (const pu of this.powerUps) {
      if (this.tiles[pu.cell.y][pu.cell.x] === "floor") keys.add(`${pu.cell.x},${pu.cell.y}`);
    }
    for (const gem of this.gems) {
      if (gem.type !== "extraLife" && this.tiles[gem.cell.y][gem.cell.x] === "floor") {
        keys.add(`${gem.cell.x},${gem.cell.y}`);
      }
    }
    return keys;
  }

  // BFS from the enemy to the nearest cell in `targets`. With passBricks=false it
  // walks only open cells (real movement, but bricks are passable while phaseWalk is
  // active); with passBricks=true it treats bricks as passable to reveal which brick
  // to bomb when no open path exists (digging).
  // Returns the first-step direction, that step's cell, and total path length.
  private bfsFirstStep(
    enemy: Enemy,
    passBricks: boolean,
    targets: Set<string>
  ): { dir: Direction | null; firstCell: Vec2 | null; dist: number } {
    const none = { dir: null, firstCell: null, dist: Infinity };
    if (targets.size === 0) return none;

    const canPhase = this.hasActiveBuff(enemy, "phaseWalk");
    const walkable = (cell: Vec2): boolean => {
      if (cell.x < 0 || cell.y < 0 || cell.x >= this.width || cell.y >= this.height) return false;
      const tile = this.tiles[cell.y][cell.x];
      if (tile === "wall") return false;
      if (tile === "brick" && !passBricks && !canPhase) return false;
      if (this.bombs.some((b) => sameCell(b.cell, cell))) return false;
      return true;
    };

    const startKey = `${enemy.cell.x},${enemy.cell.y}`;
    // each cell records the first move taken from the enemy and the distance to reach it
    const firstStep = new Map<string, { dir: Direction; cell: Vec2 }>();
    const distMap = new Map<string, number>([[startKey, 0]]);
    const queue: Vec2[] = [{ ...enemy.cell }];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curKey = `${cur.x},${cur.y}`;
      if (curKey !== startKey && targets.has(curKey)) {
        const step = firstStep.get(curKey)!;
        return { dir: step.dir, firstCell: step.cell, dist: distMap.get(curKey)! };
      }
      for (const dir of DIRECTIONS) {
        const next = add(cur, DIRS[dir]);
        const key = `${next.x},${next.y}`;
        if (distMap.has(key) || !walkable(next)) continue;
        distMap.set(key, distMap.get(curKey)! + 1);
        firstStep.set(key, curKey === startKey ? { dir, cell: next } : firstStep.get(curKey)!);
        queue.push(next);
      }
    }
    return none; // player unreachable even through bricks
  }

  private getFleeFromBombsDirection(enemy: Enemy): Direction | null {
    let bestDir: Direction | null = null;
    let bestScore = -Infinity;

    for (const dir of DIRECTIONS) {
      const next = add(enemy.cell, DIRS[dir]);
      if (!this.canEnemyOccupy(next)) continue;

      const nextInBlast = this.bombs.some((b) => {
        const dx = Math.abs(b.cell.x - next.x);
        const dy = Math.abs(b.cell.y - next.y);
        return (dx === 0 && dy <= b.range) || (dy === 0 && dx <= b.range);
      });

      // Heavily penalise moving into another blast zone; otherwise prefer maximum distance
      const score = nextInBlast
        ? -1000
        : this.bombs.reduce((sum, b) => sum + manhattan(next, b.cell), 0);

      if (score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
    }

    return bestDir;
  }

  private tryEnemyPlantBomb(enemy: Enemy, now: number): void {
    const alivePlayers = this.players.filter((p) => p.alive);
    const otherEnemies = this.enemies.filter((e) => e.id !== enemy.id);

    // Bomb when any target (player or enemy) is orthogonally aligned within blast range
    const hasAlignedTarget = [...alivePlayers.map((p) => p.cell), ...otherEnemies.map((e) => e.cell)]
      .some((cell) => {
        const dx = Math.abs(cell.x - enemy.cell.x);
        const dy = Math.abs(cell.y - enemy.cell.y);
        return (dx === 0 && dy > 0 && dy <= enemy.bombRange) ||
               (dy === 0 && dx > 0 && dx <= enemy.bombRange);
      });

    // Also bomb aggressively when a player is immediately adjacent
    const playerAdjacent = alivePlayers.some((p) => manhattan(enemy.cell, p.cell) === 1);

    // Dig: if the shortest route to the player is blocked by a brick right next to
    // the enemy, bomb it open. Compare the open path (bricks block) against the
    // ideal path (bricks passable) — a shorter ideal path means a brick is in the way.
    const playerTargets = this.playerCellKeys();
    const open = this.bfsFirstStep(enemy, false, playerTargets);
    const ideal = this.bfsFirstStep(enemy, true, playerTargets);
    const needsDig =
      ideal.firstCell !== null &&
      this.tiles[ideal.firstCell.y][ideal.firstCell.x] === "brick" &&
      ideal.dist < open.dist;

    if (!hasAlignedTarget && !playerAdjacent && !needsDig) {
      enemy.nextBombAt = now + 800;
      return;
    }

    // Per-enemy bomb limit (like a player's maxBombs), tracked via ownerEnemyId
    const activeBombs = this.bombs.filter((b) => b.ownerEnemyId === enemy.id).length;
    if (activeBombs >= enemy.maxBombs) {
      enemy.nextBombAt = now + 600;
      return;
    }
    if (this.bombs.some((b) => sameCell(b.cell, enemy.cell))) return;

    // megaBlast buff: +3 range for the next 2 bombs, just like a player
    const mega = enemy.activeBuffs.find((b) => b.type === "megaBlast" && b.usesLeft > 0);
    const range = mega ? enemy.bombRange + 3 : enemy.bombRange;

    // Self-preservation: never plant a bomb the enemy can't retreat from
    if (!this.canEscapeAfterBomb(enemy, range)) {
      enemy.nextBombAt = now + 700;
      return;
    }

    if (mega) {
      mega.usesLeft -= 1;
      if (mega.usesLeft <= 0) enemy.activeBuffs = enemy.activeBuffs.filter((b) => b !== mega);
    }

    this.bombs.push({
      id: this.nextId++,
      cell: { ...enemy.cell },
      owner: "enemy",
      ownerEnemyId: enemy.id,
      ownerCharacter: "enemy",
      range,
      plantedAt: now,
      explodesAt: now + 2200
    });
    enemy.nextBombAt = now + 3000 + Math.random() * 2000;
  }

  // Can the enemy reach a cell outside the blast after planting a bomb of `range`
  // on its own cell? BFS over open cells up to a few steps; a safe cell within reach
  // means the bomb is survivable. Prevents enemies from blowing themselves up.
  private canEscapeAfterBomb(enemy: Enemy, range: number): boolean {
    const blast = new Set(
      this.computeBlastCells(enemy.cell, range).map((c) => `${c.x},${c.y}`)
    );
    // existing bombs' blast zones are unsafe too
    for (const b of this.bombs) {
      for (const c of this.computeBlastCells(b.cell, b.range)) blast.add(`${c.x},${c.y}`);
    }

    const maxDepth = range + 2;
    const visited = new Set<string>([`${enemy.cell.x},${enemy.cell.y}`]);
    let frontier: Vec2[] = [{ ...enemy.cell }];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const nextFrontier: Vec2[] = [];
      for (const cur of frontier) {
        for (const dir of DIRECTIONS) {
          const cell = add(cur, DIRS[dir]);
          const key = `${cell.x},${cell.y}`;
          if (visited.has(key) || !this.canEnemyOccupy(cell, enemy)) continue;
          if (!blast.has(key)) return true; // reached a safe cell
          visited.add(key);
          nextFrontier.push(cell); // walk through the blast to look further out
        }
      }
      frontier = nextFrontier;
    }
    return false;
  }

  // Enemies collect items they step onto, exactly like players
  private enemyPickup(enemy: Enemy): void {
    if (this.tiles[enemy.cell.y][enemy.cell.x] !== "floor") return;

    const pu = this.powerUps.find((p) => sameCell(p.cell, enemy.cell));
    if (pu) {
      if (pu.type === "bomb") enemy.maxBombs = Math.min(5, enemy.maxBombs + 1);
      else if (pu.type === "range") enemy.bombRange = Math.min(6, enemy.bombRange + 1);
      else enemy.speed = Math.min(4, enemy.speed + 1);
      this.powerUps = this.powerUps.filter((p) => p.id !== pu.id);
    }

    const gem = this.gems.find((g) => sameCell(g.cell, enemy.cell));
    if (gem && gem.type !== "extraLife") {
      this.applyEnemyBuff(enemy, gem.type);
      this.gems = this.gems.filter((g) => g.id !== gem.id);
    }
  }

  private applyEnemyBuff(enemy: Enemy, type: BuffType): void {
    switch (type) {
      case "phaseWalk": this.addTimedBuff(enemy, "phaseWalk", 3000); break;
      case "megaBlast": this.addUsesBuff(enemy, "megaBlast", 2); break;
      case "speedSurge": this.addTimedBuff(enemy, "speedSurge", 4000); break;
      case "shield": this.addTimedBuff(enemy, "shield", 5000); break;
      // extraLife is intentionally ignored — enemies always have a single life
      case "extraLife": break;
    }
  }

  // Eject an enemy stranded inside a brick when phaseWalk expires (mirrors pushOutOfWall)
  private pushEnemyOutOfWall(enemy: Enemy): void {
    if (this.tiles[enemy.cell.y]?.[enemy.cell.x] !== "brick") return;
    const dest = this.findEscapeCell(enemy.cell);
    if (dest) enemy.cell = { ...dest };
  }

  // Is a cell standable right now (open floor/exit, no bomb)?
  private isOpenCell(cell: Vec2): boolean {
    if (cell.x < 0 || cell.y < 0 || cell.x >= this.width || cell.y >= this.height) return false;
    const tile = this.tiles[cell.y][cell.x];
    if (tile !== "floor" && tile !== "exit") return false;
    return !this.bombs.some((b) => sameCell(b.cell, cell));
  }

  // BFS out from `from` (through bricks, blocked by walls) for the nearest open cell
  // that is NOT an isolated pocket — it must have at least one open neighbour so the
  // actor actually has somewhere to walk. Falls back to the nearest open cell of any
  // kind, then null if none exists.
  private findEscapeCell(from: Vec2): Vec2 | null {
    const visited = new Set<string>([`${from.x},${from.y}`]);
    const queue: Vec2[] = [{ ...from }];
    let isolatedFallback: Vec2 | null = null;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (this.isOpenCell(cur)) {
        const hasExit = DIRECTIONS.some((d) => this.isOpenCell(add(cur, DIRS[d])));
        if (hasExit) return cur;                       // connected to open space — ideal
        if (!isolatedFallback) isolatedFallback = cur; // remember in case nothing better exists
      }
      for (const dir of DIRECTIONS) {
        const next = add(cur, DIRS[dir]);
        const key = `${next.x},${next.y}`;
        if (visited.has(key)) continue;
        if (next.x < 0 || next.y < 0 || next.x >= this.width || next.y >= this.height) continue;
        if (this.tiles[next.y]?.[next.x] === "wall") continue;
        visited.add(key);
        queue.push(next);
      }
    }
    return isolatedFallback;
  }

  private resolveBombs(now: number): void {
    const due = this.bombs.filter((b) => b.explodesAt <= now);
    for (const bomb of due) {
      this.explodeBomb(bomb, now);
    }
  }

  private explodeBomb(bomb: Bomb, now: number): void {
    if (!this.bombs.some((b) => b.id === bomb.id)) return;
    this.bombs = this.bombs.filter((b) => b.id !== bomb.id);

    const cells = this.computeExplosionCells(bomb);
    this.explosions.push({ id: this.nextId++, cells, endsAt: now + 420 });

    const scorerIndex = this.scorerIndexFor(bomb.owner);

    for (const cell of cells) {
      if (this.tiles[cell.y][cell.x] === "brick") {
        this.tiles[cell.y][cell.x] = sameCell(cell, this.exitCell) && this.exitOpen ? "exit" : "floor";
        if (scorerIndex !== null) this.scores[scorerIndex] += 25;
        this.tryDropGem(cell);
      }

      const chained = this.bombs.find((b) => sameCell(b.cell, cell));
      if (chained) {
        // Viper's bombs are immune to chain detonation
        if (chained.ownerCharacter === "viper") continue;
        this.explodeBomb(chained, now);
      }
    }

    // Shielded enemies survive the blast, just like a shielded player
    const killed = this.enemies.filter(
      (e) => cells.some((c) => sameCell(c, e.cell)) && !this.hasActiveBuff(e, "shield")
    );
    if (killed.length > 0) {
      if (scorerIndex !== null) this.scores[scorerIndex] += killed.length * 150;
      this.enemies = this.enemies.filter((e) => !killed.some((k) => k.id === e.id));
    }
  }

  // Maps a bomb owner to the player index that earns points, or null for enemy bombs
  private scorerIndexFor(owner: BombOwner): 0 | 1 | null {
    if (owner === "player0") return 0;
    if (owner === "player1") return 1;
    return null;
  }

  private computeExplosionCells(bomb: Bomb): Vec2[] {
    return this.computeBlastCells(bomb.cell, bomb.range);
  }

  // Cells a bomb at `origin` with the given range would cover (stops at walls/bricks)
  private computeBlastCells(origin: Vec2, range: number): Vec2[] {
    const cells: Vec2[] = [{ ...origin }];
    for (const direction of DIRECTIONS) {
      for (let step = 1; step <= range; step += 1) {
        const cell = {
          x: origin.x + DIRS[direction].x * step,
          y: origin.y + DIRS[direction].y * step
        };
        const tile = this.tiles[cell.y]?.[cell.x];
        if (!tile || tile === "wall") break;
        cells.push(cell);
        if (tile === "brick") break;
      }
    }
    return cells;
  }

  private tryDropGem(cell: Vec2): void {
    if (Math.random() >= GEM_DROP_CHANCE) return;
    const type = GEM_TYPES[Math.floor(Math.random() * GEM_TYPES.length)];
    this.gems.push({ id: this.nextId++, cell: { ...cell }, type });
  }

  private pickPowerUp(playerIndex: 0 | 1, cell: Vec2): void {
    const player = this.players[playerIndex];
    const found = this.powerUps.find(
      (p) => sameCell(p.cell, cell) && this.tiles[cell.y][cell.x] === "floor"
    );
    if (!found) return;

    if (found.type === "bomb") {
      player.maxBombs = Math.min(5, player.maxBombs + 1);
      this.message = `Thêm bom! Tối đa ${player.maxBombs}.`;
    } else if (found.type === "range") {
      player.bombRange = Math.min(6, player.bombRange + 1);
      this.message = "Tầm nổ tăng!";
    } else {
      player.speed = Math.min(4, player.speed + 1);
      this.message = "Chạy nhanh hơn!";
    }

    this.scores[playerIndex] += 100;
    this.powerUps = this.powerUps.filter((p) => p.id !== found.id);

    // Zara passive removed — replaced by Viper's antichain
    // Ghost passive handled in checkAllPlayerHazards
  }

  private pickGem(playerIndex: 0 | 1, cell: Vec2): void {
    const player = this.players[playerIndex];
    const found = this.gems.find(
      (g) => sameCell(g.cell, cell) && this.tiles[cell.y][cell.x] === "floor"
    );
    if (!found) return;

    this.applyBuff(player, found.type);
    this.gems = this.gems.filter((g) => g.id !== found.id);
    this.scores[playerIndex] += 150;
  }

  private applyBuff(player: Player, type: BuffType): void {
    switch (type) {
      case "extraLife":
        player.lives = Math.min(6, player.lives + 1);
        this.message = "Thêm 1 mạng!";
        break;
      case "phaseWalk":
        this.addTimedBuff(player, "phaseWalk", 3000);
        this.message = "Xuyên tường 3 giây!";
        break;
      case "megaBlast":
        this.addUsesBuff(player, "megaBlast", 2);
        this.message = "Mega blast! +3 tầm nổ (2 lần).";
        break;
      case "speedSurge":
        this.addTimedBuff(player, "speedSurge", 4000);
        this.message = "Tốc độ tối đa 4 giây!";
        break;
      case "shield":
        this.addTimedBuff(player, "shield", 5000);
        this.message = "Khiên bảo vệ 5 giây!";
        break;
    }
  }

  private addTimedBuff(actor: { activeBuffs: ActiveBuff[] }, type: BuffType, duration: number): void {
    const existing = actor.activeBuffs.find((b) => b.type === type);
    const expiry = this.phaserNow + duration;
    if (existing) {
      existing.expiresAt = Math.max(existing.expiresAt, expiry);
    } else {
      actor.activeBuffs.push({ type, expiresAt: expiry, usesLeft: 0 });
    }
  }

  private addUsesBuff(actor: { activeBuffs: ActiveBuff[] }, type: BuffType, uses: number): void {
    const existing = actor.activeBuffs.find((b) => b.type === type);
    if (existing) {
      existing.usesLeft += uses;
    } else {
      actor.activeBuffs.push({ type, expiresAt: 0, usesLeft: uses });
    }
  }

  private tickBuffs(now: number): void {
    for (const player of this.players) {
      if (!player.alive) continue;
      const phaseExpiring = player.activeBuffs.some(
        (b) => b.type === "phaseWalk" && b.expiresAt > 0 && b.expiresAt <= now
      );
      player.activeBuffs = player.activeBuffs.filter(
        (b) => b.usesLeft > 0 || (b.expiresAt > 0 && b.expiresAt > now)
      );
      if (phaseExpiring) this.pushOutOfWall(player, now);
    }
  }

  private pushOutOfWall(player: Player, now: number): void {
    if (this.tiles[player.cell.y]?.[player.cell.x] !== "brick") return;

    // Land on a floor cell that is connected to open space, not an isolated pocket
    const dest = this.findEscapeCell(player.cell) ?? PLAYER_SPAWNS[player.index];
    player.cell = { ...dest };
    // Brief invincibility so player isn't instantly killed after teleport
    player.invincibleUntil = Math.max(player.invincibleUntil, now + 1200);
    this.message = "Xuyên tường hết hạn — đẩy ra đường!";
  }

  hasActiveBuff(actor: { activeBuffs: ActiveBuff[] }, type: BuffType): boolean {
    const buff = actor.activeBuffs.find((b) => b.type === type);
    if (!buff) return false;
    if (buff.usesLeft > 0) return true;
    if (buff.expiresAt > 0 && buff.expiresAt > this.phaserNow) return true;
    return false;
  }

  private checkAllPlayerHazards(now: number): void {
    for (const player of this.players) {
      if (!player.alive || now < player.invincibleUntil) continue;
      if (this.hasActiveBuff(player, "shield")) continue;

      // Only bombs are lethal — touching an enemy no longer costs a life
      const hitByExplosion = this.explosions.some((e) =>
        e.cells.some((c) => sameCell(c, player.cell))
      );

      if (!hitByExplosion) continue;

      player.lives -= 1;
      if (player.lives <= 0) {
        player.alive = false;
        player.lives = 0;
        continue;
      }

      player.cell = { ...PLAYER_SPAWNS[player.index] };
      const invincibleDuration = player.character === "ghost" ? 4000 : 1800;
      player.invincibleUntil = now + invincibleDuration;
      this.message = `Người chơi ${player.index + 1} mất 1 mạng!`;
    }
  }
}
