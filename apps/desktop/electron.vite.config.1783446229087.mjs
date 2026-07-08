// electron.vite.config.ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
var __electron_vite_injected_dirname = "D:\\GitHub\\Wispr-Flow-Clone\\.claude\\worktrees\\beautiful-dirac-5601a2\\apps\\desktop";
var electron_vite_config_default = defineConfig({
  main: {
    // No runtime dependencies yet — everything (incl. @flow/shared ESM) is bundled into CJS.
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
          overlay: resolve(__electron_vite_injected_dirname, "src/preload/overlay.ts")
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html"),
          overlay: resolve(__electron_vite_injected_dirname, "src/renderer/overlay.html")
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
