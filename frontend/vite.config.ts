import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4000",
      "/health": "http://127.0.0.1:4000",
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return "react";
          if (/node_modules[\\/](zod|react-hook-form|@hookform)[\\/]/.test(id))
            return "forms";
          if (
            /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/.test(
              id,
            )
          )
            return "motion";
          if (
            /node_modules[\\/](@tanstack|react-router|react-router-dom)[\\/]/.test(
              id,
            )
          )
            return "routing";
        },
      },
    },
  },
});
