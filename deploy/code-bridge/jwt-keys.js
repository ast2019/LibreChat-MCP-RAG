/**
 * Writes an Ed25519 keypair for the Attached VM bridge into the mounted volume.
 * The private key stays on this volume for the api container. The public key is
 * the only file under /keys/public, which the bridge mounts alone.
 * Re-running keeps the existing private key and refreshes the public file.
 * Do not print either key.
 */
const { createPrivateKey, createPublicKey, generateKeyPairSync } = require('crypto');
const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');

const privatePath = '/keys/private.pem';
const publicDir = '/keys/public';
const publicPath = `${publicDir}/lc-codeapi-2026-05.pem`;

mkdirSync(publicDir, { recursive: true });

const existing = existsSync(privatePath) ? readFileSync(privatePath, 'utf8') : '';
if (existing.trim() === '') {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}

chmodSync(privatePath, 0o600);
const publicKey = createPublicKey(createPrivateKey(readFileSync(privatePath)));
writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
chmodSync(publicPath, 0o644);
