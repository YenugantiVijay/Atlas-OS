process.env.ASTRO_TELEMETRY_DISABLED = "1";

import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { getPreviewVersion, previewVersionHeader } from "./scripts/dev-preview-version.mjs";

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://atlas-os-8328y.web.app",
  output: "static",
  integrations: [
    react(),
    sitemap(),
  ],
  build: {
    format: "directory",
  },
  vite: {
    server: { strictPort: true },
    plugins: [{
      name: "atlas-dev-preview-version",
      configureServer(server) {
        const version = getPreviewVersion();
        server.middlewares.use((_request, response, next) => {
          response.setHeader(previewVersionHeader, version);
          next();
        });
      },
    }],
  },
});
