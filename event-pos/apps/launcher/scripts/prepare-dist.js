#!/usr/bin/env node
/**
 * prepare-dist.js
 * Script di preparazione per la build di distribuzione.
 * Compila TypeScript, builda Next.js, scarica Node.js portable.
 * 
 * Uso: node scripts/prepare-dist.js [--skip-node]
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

const ROOT = path.join(__dirname, '..', '..', '..');
const skipNode = process.argv.includes('--skip-node');
const platform = process.platform;
const arch = process.arch;

// ── Versione Node.js da scaricare ─────────────────────────────────────────────
const NODE_VERSION = '20.11.1'; // LTS
const NODE_DIST_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;

function getNodeDownloadInfo() {
  if (platform === 'darwin') {
    return {
      url: `${NODE_DIST_BASE}/node-v${NODE_VERSION}-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`,
      ext: 'tar.gz',
      binPath: `node-v${NODE_VERSION}-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}/bin/node`,
    };
  }
  if (platform === 'win32') {
    return {
      url: `${NODE_DIST_BASE}/node-v${NODE_VERSION}-win-x64.zip`,
      ext: 'zip',
      binPath: `node-v${NODE_VERSION}-win-x64/node.exe`,
    };
  }
  // linux
  return {
    url: `${NODE_DIST_BASE}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    ext: 'tar.gz',
    binPath: `node-v${NODE_VERSION}-linux-x64/bin/node`,
  };
}

function run(cmd, cwd = ROOT) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Redirect
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function main() {
  console.log('═'.repeat(60));
  console.log(' SagraPOS — Preparazione Build Distribuzione');
  console.log('═'.repeat(60));

  // ── 1. Build API ────────────────────────────────────────────────────────────
  console.log('\n[1/4] Build API Server...');
  run('npx tsc', path.join(ROOT, 'apps', 'api'));
  console.log('✅ API compilata');

  // ── 2. Build Web App ────────────────────────────────────────────────────────
  console.log('\n[2/4] Build Web App...');
  run('npx next build', path.join(ROOT, 'apps', 'web'));
  console.log('✅ Web App compilata');

  // ── 3. Build Print Agent ────────────────────────────────────────────────────
  console.log('\n[3/4] Build Print Agent...');
  run('npx tsc', path.join(ROOT, 'apps', 'print-agent'));
  console.log('✅ Print Agent compilato');

  // ── 4. Node.js portable ─────────────────────────────────────────────────────
  if (!skipNode) {
    console.log('\n[4/4] Download Node.js portable...');
    const resourcesDir = path.join(__dirname, '..', 'resources', 'node');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const nodeBin = path.join(resourcesDir, platform === 'win32' ? 'node.exe' : 'node');
    if (fs.existsSync(nodeBin)) {
      console.log('⏭  Node.js portable già presente, salto download');
    } else {
      const info = getNodeDownloadInfo();
      const tmpPath = path.join(resourcesDir, `node-download.${info.ext}`);

      console.log(`   Scarico da: ${info.url}`);
      await downloadFile(info.url, tmpPath);
      console.log('   Estrazione...');

      if (info.ext === 'tar.gz') {
        execSync(`tar -xzf "${tmpPath}" -C "${resourcesDir}"`, { stdio: 'inherit' });
        const extractedBin = path.join(resourcesDir, info.binPath);
        fs.copyFileSync(extractedBin, nodeBin);
        fs.chmodSync(nodeBin, '755');
        // Pulisci
        const folderName = info.binPath.split('/')[0];
        fs.rmSync(path.join(resourcesDir, folderName), { recursive: true, force: true });
      } else if (info.ext === 'zip') {
        execSync(`powershell -Command "Expand-Archive -Path '${tmpPath}' -DestinationPath '${resourcesDir}'"`, { stdio: 'inherit' });
        const extractedBin = path.join(resourcesDir, info.binPath);
        fs.copyFileSync(extractedBin, nodeBin);
        const folderName = info.binPath.split('/')[0];
        fs.rmSync(path.join(resourcesDir, folderName), { recursive: true, force: true });
      }

      fs.unlinkSync(tmpPath);
      console.log(`✅ Node.js ${NODE_VERSION} portable installato`);
    }
  } else {
    console.log('\n[4/4] Salto download Node.js (--skip-node)');
  }

  console.log('\n' + '═'.repeat(60));
  console.log(' ✅ Build completata! Esegui: npm run pack');
  console.log('═'.repeat(60) + '\n');
}

main().catch(e => {
  console.error('\n❌ Errore durante la preparazione:', e.message);
  process.exit(1);
});
