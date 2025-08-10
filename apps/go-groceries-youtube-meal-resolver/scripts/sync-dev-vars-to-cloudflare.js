import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_VARS_PATH = path.join(__dirname, '..', '.dev.vars');

async function syncSecrets() {
  if (!fs.existsSync(DEV_VARS_PATH)) {
    console.error(`❌ File "${DEV_VARS_PATH}" not found.`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(DEV_VARS_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (!key || valueParts.length === 0) {
      console.warn(`⚠️ Skipping invalid line: ${line}`);
      continue;
    }

    const value = valueParts.join('=').trim();

    console.log(`🔐 Syncing secret: ${key}`);

    await new Promise((resolve, reject) => {
      const child = spawn('wrangler', ['secret', 'put', key], {
        stdio: ['pipe', 'inherit', 'inherit'],
      });

      child.stdin.write(value + '\n');
      child.stdin.end();

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ ${key} synced`);
          resolve();
        } else {
          console.error(`❌ Failed to sync ${key}`);
          reject();
        }
      });
    });
  }
}

syncSecrets().catch((err) => {
  console.error(err);
  process.exit(1);
});
