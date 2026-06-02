import type { PowerUp, Tile, Vec2 } from "./types";

export const LEVEL_WIDTH = 15;
export const LEVEL_HEIGHT = 13;

export const PLAYER_SPAWNS: Vec2[] = [
  { x: 1, y: 1 },
  { x: 13, y: 1 }
];

export const ENEMY_SPAWNS: Vec2[] = [
  { x: 13, y: 11 },
  { x: 7, y: 9 },
  { x: 3, y: 11 },
  { x: 7, y: 5 }
];

// Each enemy spawn gets an L-shaped clearing (spawn + 2 neighbours) so the NPC
// always has room to move and place a bomb on game start.
// Neighbours are chosen to avoid pillar cells (even x AND even y = always wall).
const ENEMY_CLEAR_NEIGHBOURS: Vec2[] = [
  { x: 12, y: 11 }, { x: 13, y: 10 }, // enemy 0 (13,11): left + up
  { x:  6, y:  9 }, { x:  7, y:  8 }, // enemy 1  (7, 9): left + up
  { x:  4, y: 11 }, { x:  3, y: 10 }, // enemy 2  (3,11): right + up
  { x:  6, y:  5 }, { x:  7, y:  4 }, // enemy 3  (7, 5): left + up
];

const RESERVED_CLEAR = new Set([
  "1,1", "2,1", "1,2",
  "13,1", "12,1", "13,2",
  ...ENEMY_SPAWNS.map((cell) => `${cell.x},${cell.y}`),
  ...ENEMY_CLEAR_NEIGHBOURS.map((cell) => `${cell.x},${cell.y}`)
]);

function key(cell: Vec2): string {
  return `${cell.x},${cell.y}`;
}

function random(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function createLevel(seed = 7331, brickRate = 0.58): { tiles: Tile[][]; powerUps: PowerUp[]; exitCell: Vec2 } {
  const rand = random(seed);
  const tiles: Tile[][] = [];
  const bricks: Vec2[] = [];

  for (let y = 0; y < LEVEL_HEIGHT; y += 1) {
    const row: Tile[] = [];
    for (let x = 0; x < LEVEL_WIDTH; x += 1) {
      const border = x === 0 || y === 0 || x === LEVEL_WIDTH - 1 || y === LEVEL_HEIGHT - 1;
      const pillar = x % 2 === 0 && y % 2 === 0;
      const safe = RESERVED_CLEAR.has(`${x},${y}`);

      if (border || pillar) {
        row.push("wall");
      } else if (!safe && rand() < brickRate) {
        row.push("brick");
        bricks.push({ x, y });
      } else {
        row.push("floor");
      }
    }
    tiles.push(row);
  }

  const exitCell = bricks[Math.floor(rand() * bricks.length)] ?? { x: LEVEL_WIDTH - 2, y: LEVEL_HEIGHT - 2 };
  const powerUps: PowerUp[] = [];
  const shuffled = [...bricks].filter((cell) => key(cell) !== key(exitCell)).sort(() => rand() - 0.5);
  const types = ["bomb", "range", "speed", "range", "bomb"] as const;

  types.forEach((type, index) => {
    const cell = shuffled[index];
    if (cell) {
      powerUps.push({ id: index + 1, cell: { ...cell }, type });
    }
  });

  return { tiles, powerUps, exitCell };
}
