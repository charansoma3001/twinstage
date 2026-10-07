import { defineConfig } from "vite";
import { resolve } from "node:path";
import { compressMeshes } from "../scripts/compress-meshes.mjs";

// /settings and /drive are pages, not SPA routes: map them onto their HTML
// files in development the same way the bridge does in production.
const pageRoutes = {
  name: "page-routes",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url.split("?")[0];
      if (url === "/settings") req.url = req.url.replace("/settings", "/settings.html");
      else if (url === "/drive") req.url = req.url.replace("/drive", "/drive.html");
      next();
    });
  }
};

// The STLs in public/ are copied as they are; swap them for compressed GLBs.
const meshes = {
  name: "compress-meshes",
  apply: "build",
  async closeBundle() {
    await compressMeshes(resolve(__dirname, "../dist"));
  }
};

export default defineConfig({
  // "/" normally; the Pages build sets VITE_BASE=/twinstage/.
  base: process.env.VITE_BASE || "/",
  plugins: [pageRoutes, meshes],
  // One .env at the repo root serves both the bridge and the web build.
  envDir: resolve(__dirname, ".."),
  server: {
    // The bridge owns /api (joint map, state); the dev server only serves the UI.
    proxy: { "/api": "http://localhost:8787" },
    port: 5173,
    open: true
  },
  build: {
    target: "es2020",
    outDir: "../dist", emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        stage: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html")
      }
    }
  }
});
