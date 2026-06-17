import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative asset paths so the build also works served from a Base36/SuiNS
  // subdomain on Walrus Sites (https://<base36>.wal.app). Harmless for local dev.
  base: "./",
  plugins: [react(), tailwindcss()],
});
