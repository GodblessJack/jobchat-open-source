#!/usr/bin/env node
// Copy runtime assets that are resolved relative to the compiled server.
import { cp } from 'node:fs/promises';

await cp('server/skills', 'dist/server/server/skills', {
  recursive: true,
  force: true,
});
console.log('Runtime assets copied to dist/server/server/skills.');
