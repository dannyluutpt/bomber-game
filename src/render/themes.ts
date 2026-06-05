import type { MapThemeId } from "../simulation/types";

// A MapTheme is purely cosmetic — it recolours the background, board and blocks.
// It never touches the simulation, so the same gameplay runs under any theme.
export interface MapTheme {
  id: MapThemeId;
  name: string;
  blurb: string;
  // Background (vertical gradient + nebula glow + stars)
  bgTop: number;
  bgBottom: number;
  nebula: number;
  star: number;
  // Board floor
  floor: number;
  floorAlt: number;
  grid: number;
  // Indestructible walls (3-face bevel: body / lit top / dark side)
  wall: number;
  wallTop: number;
  wallSide: number;
  // Destructible bricks
  brick: number;
  brickTop: number;
  brickSide: number;
  // Frame / glow accent
  accent: number;
  accentSoft: number;
}

export const THEMES: Record<MapThemeId, MapTheme> = {
  // Ref 1 — deep space, green-teal nebula, gold pipes, stone & crates.
  space: {
    id: "space", name: "Vũ trụ ống đồng", blurb: "Tinh vân xanh, trụ đá & thùng gỗ.",
    bgTop: 0x081019, bgBottom: 0x0a2a24, nebula: 0x1f7d5f, star: 0xbfe9ff,
    floor: 0x223247, floorAlt: 0x1b2a3c, grid: 0x2f4a63,
    wall: 0x6f7f93, wallTop: 0xd5e3f3, wallSide: 0x394658,
    brick: 0xb86a32, brickTop: 0xf0a35d, brickSide: 0x7a3f1c,
    accent: 0xffa53b, accentSoft: 0x35d9ff
  },
  // Ref 2 — purple/magenta nebula, icy white-blue blocks, crystal vibe.
  ice: {
    id: "ice", name: "Băng pha lê", blurb: "Tinh vân tím, khối băng trắng xanh.",
    bgTop: 0x1a1030, bgBottom: 0x3a1440, nebula: 0x8a48c0, star: 0xeaf2ff,
    floor: 0x2c4a66, floorAlt: 0x254059, grid: 0x436a8f,
    wall: 0x9fc4e8, wallTop: 0xeaf6ff, wallSide: 0x5a86ad,
    brick: 0x66b8e0, brickTop: 0xbdeaff, brickSide: 0x2f6f9a,
    accent: 0x4fd6ff, accentSoft: 0xb98bff
  },
  // Ref 3 — dark red/maroon, navy metal blocks, orange hazard energy.
  industrial: {
    id: "industrial", name: "Công nghiệp dung nham", blurb: "Nền đỏ, kim loại & năng lượng cam.",
    bgTop: 0x2a0a12, bgBottom: 0x4a0e16, nebula: 0x9c2436, star: 0xffd9c2,
    floor: 0x1e2730, floorAlt: 0x17202a, grid: 0x394655,
    wall: 0x4a5a72, wallTop: 0x90a9c9, wallSide: 0x29344a,
    brick: 0x33425d, brickTop: 0x5d76a0, brickSide: 0x1a2436,
    accent: 0xff5a2a, accentSoft: 0xffc24d
  }
};

export const THEME_LIST: MapTheme[] = [THEMES.space, THEMES.ice, THEMES.industrial];
