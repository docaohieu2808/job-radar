import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // The screens import the shared scoring and preference modules from ../src.
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] }, proxy: { "/api": "http://localhost:8080" } },
});
