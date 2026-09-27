import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// En desarrollo, la UI corre en :8080 y el bridge en :3001.
// El proxy hace que /api y /socket.io lleguen al bridge sin CORS ni URLs
// absolutas en el codigo: en produccion el bridge sirve la UI compilada y
// las rutas son relativas al mismo origen.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 8080,
    proxy: {
      "/api":       { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
