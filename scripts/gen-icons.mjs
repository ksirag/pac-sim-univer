// Генерирует PNG-иконки из public/icon.svg. Запуск: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url));
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;

await sharp(svg).resize(192, 192).png().toFile(out('pwa-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('pwa-512.png'));
await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
await sharp(svg).resize(32, 32).png().toFile(out('favicon-32.png'));

// maskable: иконка в «безопасной зоне» (80%) на сплошном фоне, углы обрежет система
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b7a57' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('pwa-maskable-512.png'));
console.log('Иконки созданы');
