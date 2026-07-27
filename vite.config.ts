import { resolve } from "node:path";
import { defineConfig } from "vite";

const base = process.env.VITE_BASE_PATH ?? "/";

if (!base.startsWith("/") || !base.endsWith("/")) {
  throw new Error("VITE_BASE_PATH must start and end with '/'.");
}

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "main.html"),
        background: resolve(import.meta.dirname, "background.html"),
      },
    },
  },
});
