import type { MapThemeId } from "../simulation/types";

// A MapTheme is purely cosmetic — it recolours the background, board and blocks
// and selects a biome drawing style. It never touches the simulation.
export interface MapTheme {
  id: MapThemeId;
  kind: "volcano" | "ice" | "jungle"; // biome motif drawn on blocks/floor
  name: string;
  blurb: string;
  // Background gradient + ambient specks + accent
  bgTop: number;
  bgBottom: number;
  nebula: number;   // soft glow blob colour
  star: number;     // ambient speck colour
  // Board floor (checker of two tones + grid lines)
  floor: number;
  floorAlt: number;
  grid: number;
  // Indestructible walls (3-face look: body / lit top / dark side)
  wall: number;
  wallTop: number;
  wallSide: number;
  // Destructible bricks
  brick: number;
  brickTop: number;
  brickSide: number;
  // Biome detail colour (lava cracks / ice shine / leaf highlight) + UI accent
  detail: number;
  accent: number;
  accentSoft: number;
}

export const THEMES: Record<MapThemeId, MapTheme> = {
  // 🌋 Volcano — black basalt, obsidian walls, cracked rock glowing with magma.
  volcano: {
    id: "volcano", kind: "volcano", name: "Núi lửa", blurb: "Đá đen, dung nham nứt cháy đỏ.",
    bgTop: 0x1a0805, bgBottom: 0x40100a, nebula: 0xb83410, star: 0xffb066,
    floor: 0x2a1410, floorAlt: 0x21100c, grid: 0x4a2418,
    wall: 0x3a2a2a, wallTop: 0x5e4742, wallSide: 0x201414,
    brick: 0x5a2a1c, brickTop: 0x8a4326, brickSide: 0x331208,
    detail: 0xff7311, accent: 0xff5a1e, accentSoft: 0xffc24d
  },
  // ❄️ Ice — frozen tundra, glassy ice walls, packed-snow crates with a cool shine.
  ice: {
    id: "ice", kind: "ice", name: "Băng tuyết", blurb: "Băng pha lê, tuyết phủ lạnh giá.",
    bgTop: 0x0a1b33, bgBottom: 0x123a5c, nebula: 0x4aa3d6, star: 0xeaf6ff,
    floor: 0x3a5b78, floorAlt: 0x32526d, grid: 0x6a93b4,
    wall: 0x9fd0ec, wallTop: 0xeafaff, wallSide: 0x5d8fb4,
    brick: 0xbfe6f5, brickTop: 0xeefbff, brickSide: 0x77abca,
    detail: 0xffffff, accent: 0x5fd6ff, accentSoft: 0xbfeaff
  },
  // 🌴 Jungle — lush grass, mossy stone walls, wooden/leafy breakable crates.
  jungle: {
    id: "jungle", kind: "jungle", name: "Rừng rậm", blurb: "Cỏ xanh, đá rêu & gỗ mục.",
    bgTop: 0x0a1e10, bgBottom: 0x123d1c, nebula: 0x3fae57, star: 0xd6ff9e,
    floor: 0x2f6a35, floorAlt: 0x28602e, grid: 0x47853f,
    wall: 0x6b7a55, wallTop: 0x9fb074, wallSide: 0x3f4a30,
    brick: 0x8a5a30, brickTop: 0xb98049, brickSide: 0x583718,
    detail: 0x8fd14a, accent: 0x7ed957, accentSoft: 0xd6ff9e
  }
};

export const THEME_LIST: MapTheme[] = [THEMES.volcano, THEMES.ice, THEMES.jungle];
