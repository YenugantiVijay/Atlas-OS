process.env.ASTRO_TELEMETRY_DISABLED = "1";

import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { getPreviewVersion, previewVersionHeader } from "./scripts/dev-preview-version.mjs";

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "https://atlasos.business",
  output: "static",
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    react(),
    sitemap(),
  ],
  build: {
    format: "directory",
  },
  vite: {
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
