import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// CLEAN START v2.0.1
// Intentionally no custom "@/" alias. Earlier deployment attempts failed while
// TanStack route splitting was resolving an alias import. The application now
// uses explicit relative imports so Vite/Rollup can resolve every local module
// without depending on alias/plugin ordering.
export default defineConfig({
  build: {
    sourcemap: false,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
