import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/bomber-game/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      input: {
        // Main game + the standalone character-picker gallery page.
        main: resolve(__dirname, "index.html"),
        models: resolve(__dirname, "models.html")
      }
    }
  }
});
