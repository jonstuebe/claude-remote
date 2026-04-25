import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const port = Number(process.env.PORT ?? 2633);
const apiPort = Number(process.env.API_PORT ?? 2634);

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port,
    host: process.env.HOST ?? "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: { port },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
});
