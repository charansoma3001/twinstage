import { defineConfig } from "vite";
import { resolve } from "node:path";

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

export default defineConfig({
  plugins: [pageRoutes],
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
