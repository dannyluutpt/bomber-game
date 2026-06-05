import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

let gameModule;

async function loadGameModule() {
  if (gameModule) return gameModule;

  const outdir = await mkdtemp(path.join(tmpdir(), "game-model-test-"));
  const outfile = path.join(outdir, "GameModel.mjs");

  await build({
    entryPoints: ["src/simulation/GameModel.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent"
  });

  gameModule = await import(pathToFileURL(outfile).href);
  return gameModule;
}

function openArena(width, height) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "wall" : "floor"
    )
  );
}

test("NPC characters exclude human picks while allowing both players to duplicate", async () => {
  const { GameModel } = await loadGameModule();
  const model = new GameModel();

  model.start({
    difficulty: "hard",
    mode: "versus",
    characters: ["nova", "nova"],
    seed: 7331,
    now: 0
  });

  assert.equal(model.players[0].character, "nova");
  assert.equal(model.players[1].character, "nova");
  assert.equal(model.enemies.length, 4);
  assert.ok(model.enemies.every((enemy) => enemy.character !== "nova"));
});

test("NPCs do not plant bombs solely because another NPC is aligned", async () => {
  const { GameModel } = await loadGameModule();
  const model = new GameModel();

  model.start({
    difficulty: "hard",
    mode: "single",
    characters: ["nova"],
    seed: 7331,
    now: 0
  });

  model.tiles = openArena(model.width, model.height);
  model.players[0].cell = { x: 1, y: 1 };
  model.enemies = [
    {
      ...model.enemies[0],
      id: 101,
      cell: { x: 8, y: 6 },
      direction: "left",
      nextMoveAt: 99_999,
      nextBombAt: 0,
      bombRange: 2,
      maxBombs: 2,
      speed: 1,
      activeBuffs: []
    },
    {
      ...model.enemies[1],
      id: 102,
      cell: { x: 10, y: 6 },
      direction: "left",
      nextMoveAt: 99_999,
      nextBombAt: 99_999,
      bombRange: 2,
      maxBombs: 2,
      speed: 1,
      activeBuffs: []
    }
  ];

  model.update(1, 16);

  assert.equal(model.bombs.length, 0);
});

test("NPC bombs carry the NPC character perk when attacking a player", async () => {
  const { GameModel } = await loadGameModule();
  const model = new GameModel();

  model.start({
    difficulty: "hard",
    mode: "single",
    characters: ["nova"],
    seed: 7331,
    now: 0
  });

  model.tiles = openArena(model.width, model.height);
  model.players[0].cell = { x: 5, y: 6 };
  model.enemies = [
    {
      ...model.enemies[0],
      id: 201,
      cell: { x: 7, y: 6 },
      direction: "left",
      nextMoveAt: 99_999,
      nextBombAt: 0,
      bombRange: 2,
      maxBombs: 2,
      speed: 1,
      activeBuffs: []
    }
  ];

  model.update(1, 16);

  assert.equal(model.bombs.length, 1);
  assert.equal(model.bombs[0].ownerCharacter, model.enemies[0].character);
});

test("NPCs do not plant attack bombs through walls", async () => {
  const { GameModel } = await loadGameModule();
  const model = new GameModel();

  model.start({
    difficulty: "hard",
    mode: "single",
    characters: ["nova"],
    seed: 7331,
    now: 0
  });

  model.tiles = openArena(model.width, model.height);
  model.tiles[6][6] = "wall";
  model.players[0].cell = { x: 5, y: 6 };
  model.enemies = [
    {
      ...model.enemies[0],
      id: 301,
      cell: { x: 7, y: 6 },
      direction: "left",
      nextMoveAt: 99_999,
      nextBombAt: 0,
      bombRange: 3,
      maxBombs: 2,
      speed: 1,
      activeBuffs: []
    }
  ];

  model.update(1, 16);

  assert.equal(model.bombs.length, 0);
});

test("NPCs avoid planting bombs that would hit another NPC", async () => {
  const { GameModel } = await loadGameModule();
  const model = new GameModel();

  model.start({
    difficulty: "hard",
    mode: "single",
    characters: ["nova"],
    seed: 7331,
    now: 0
  });

  model.tiles = openArena(model.width, model.height);
  model.players[0].cell = { x: 5, y: 6 };
  model.enemies = [
    {
      ...model.enemies[0],
      id: 401,
      cell: { x: 7, y: 6 },
      direction: "left",
      nextMoveAt: 99_999,
      nextBombAt: 0,
      bombRange: 2,
      maxBombs: 2,
      speed: 1,
      activeBuffs: []
    },
    {
      ...model.enemies[1],
      id: 402,
      cell: { x: 9, y: 6 },
      direction: "left",
      nextMoveAt: 99_999,
      nextBombAt: 99_999,
      bombRange: 2,
      maxBombs: 2,
      speed: 1,
      activeBuffs: []
    }
  ];

  model.update(1, 16);

  assert.equal(model.bombs.length, 0);
});
