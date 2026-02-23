import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/index.ts",
    daemon: "src/daemon/index.ts",
  },
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  shims: true,
  noExternal: ["@arc0/crypto", "@arc0/types"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
