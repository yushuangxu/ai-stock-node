import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { build: buildApplication } = require('fastify-cli/helper');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AppPath = path.join(__dirname, '..', 'app.js');

export function config() {
  return {
    skipOverride: true,
  };
}

export async function build(t) {
  const argv = [AppPath];
  const app = await buildApplication(argv, config());
  t.after(() => app.close());
  return app;
}
