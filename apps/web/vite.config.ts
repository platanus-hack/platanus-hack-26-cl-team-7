import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SENTINEL = process.env.SENTINEL_URL ?? "http://127.0.0.1:8787";

/** Writes .br and .gz next to each text asset so Sentinel can serve them without compressing per request. */
function precompress(): Plugin {
  let outDir = "dist";
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  return {
    name: "precompress",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json)$/.test(file) || statSync(file).size < 1024) continue;
        const buf = readFileSync(file);
        writeFileSync(`${file}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(buf, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  clearScreen: false,
  // Same origin in development too: the browser talks to Vite, and Vite forwards /v1 to Sentinel.
  server: { port: 5173, strictPort: true, proxy: { "/v1": { target: SENTINEL, changeOrigin: true } } },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
});
