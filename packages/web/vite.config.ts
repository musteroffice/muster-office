import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";

const target = process.env["AUTOMICVAULT_DEV_SERVER"] ?? "http://127.0.0.1:4747";

// The Automicvault server only answers loopback Host/Origin values, so the dev proxy rewrites them.
const proxied = (): ProxyOptions => ({
  target,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../../dist/web", emptyOutDir: true, sourcemap: false, target: "es2022" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/events": proxied(), "/api": proxied(), "/healthz": proxied() },
  },
});
