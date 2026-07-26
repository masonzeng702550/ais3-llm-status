// @ts-check
import { defineConfig } from 'astro/config';

const OWNER = process.env.SITE_OWNER ?? 'masonzeng702550';
const REPO = process.env.SITE_REPO ?? 'ais3-llm-status';

// A custom domain serves from the root; github.io serves from /<repo>/.
const customDomain = process.env.SITE_DOMAIN;

export default defineConfig({
  site: customDomain ?? `https://${OWNER}.github.io`,
  base: customDomain ? '/' : `/${REPO}`,
  trailingSlash: 'ignore',
  build: {
    inlineStylesheets: 'always',
  },
  devToolbar: {
    enabled: false,
  },
});
