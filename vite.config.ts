import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      cors: true,
      hmr: process.env.DISABLE_HMR !== "true",
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
  },
  tanstackStart: {
    tsr: { autoCodeSplitting: true },
    server: { entry: "server" },
  },
});
