export type Direction = "up" | "down" | "left" | "right";
export type Tile = "floor" | "wall" | "brick" | "exit";
export type PowerUpType = "bomb" | "range" | "speed";
export type BuffType = "extraLife" | "phaseWalk" | "megaBlast" | "speedSurge" | "shield";
export type GamePhase = "ready" | "playing" | "paused" | "won" | "lost";
export type DifficultyId = "easy" | "normal" | "hard";
export type CharacterId = "nova" | "orion" | "titan" | "ghost" | "echo" | "viper";
export type GameMode = "single" | "versus";
export type MapThemeId = "volcano" | "ice" | "jungle";
export type BombOwner = "player0" | "player1" | "enemy";

export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  timeLimit: number;
  enemyCount: number;
  enemyStepMs: number;
  brickRate: number;
  lives: number;
}

export interface CharacterConfig {
  id: CharacterId;
  name: string;
  color: number;
  accent: number;
  bonus: "speed" | "range" | "tank" | "guardian" | "multibomb" | "antichain";
  spriteFrame: number;
  description: string;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface ActiveBuff {
  type: BuffType;
  expiresAt: number;
  usesLeft: number;
}

export interface Player {
  index: 0 | 1;
  cell: Vec2;
  lives: number;
  maxBombs: number;
  bombRange: number;
  speed: number;
  invincibleUntil: number;
  character: CharacterId;
  activeBuffs: ActiveBuff[];
  alive: boolean;
}

export interface Enemy {
  id: number;
  cell: Vec2;
  character: CharacterId;
  direction: Direction;
  nextMoveAt: number;
  maxBombs: number;
  bombRange: number;
  speed: number;
  activeBuffs: ActiveBuff[];
  nextBombAt: number;
}

export interface Bomb {
  id: number;
  cell: Vec2;
  owner: BombOwner;
  ownerEnemyId?: number;
  ownerCharacter: CharacterId | "enemy";
  range: number;
  plantedAt: number;
  explodesAt: number;
}

export interface Explosion {
  id: number;
  cells: Vec2[];
  endsAt: number;
}

export interface PowerUp {
  id: number;
  cell: Vec2;
  type: PowerUpType;
}

export interface Gem {
  id: number;
  cell: Vec2;
  type: BuffType;
}

export interface GameSnapshot {
  phase: GamePhase;
  width: number;
  height: number;
  tiles: Tile[][];
  players: Player[];
  enemies: Enemy[];
  bombs: Bomb[];
  explosions: Explosion[];
  powerUps: PowerUp[];
  gems: Gem[];
  scores: [number, number];
  timeLeft: number;
  exitOpen: boolean;
  message: string;
  difficulty: DifficultyId;
  mode: GameMode;
  winnerIndex: number | null;
}
