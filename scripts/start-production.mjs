#!/usr/bin/env node
// Run the compiled JobChat server and gateway with shared signal handling.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const processes = [
  spawn(process.execPath, ['dist/server/server/index.js'], {
    cwd: path.join(rootDir, 'jchat'),
    env: process.env,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['gateway.js'], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of processes) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error(`Production process error: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Production process exited (code=${code}, signal=${signal}); shutting down.`);
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
