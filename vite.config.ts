import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: Number(process.env.PORT) || 5173, open: false },
  build: {
    target: "es2020",
    outDir: "dist",
    // App code is split out (~177 kB); the only remaining large chunk is the
    // Three.js vendor bundle, which is irreducible and well-cached. Lift the
    // warning just above it so a clean build stays quiet.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split the Three.js runtime into its own vendor chunk. It dwarfs the
        // app code and almost never changes, so isolating it keeps the app
        // chunk small and lets the browser cache the heavy vendor bundle across
        // deploys.
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "vendor-three";
        },
      },
    },
  },
});
