import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Master SVG design for "متقن" (Holy Quran / Book with Islamic star and emerald/gold palette)
const svgMaster = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#065f46" />
      <stop offset="50%" stop-color="#047857" />
      <stop offset="100%" stop-color="#064e3b" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="pageGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fef3c7" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Background rounded canvas -->
  <rect width="512" height="512" rx="110" fill="url(#bgGrad)" />

  <!-- Subtle inner border -->
  <rect x="20" y="20" width="472" height="472" rx="90" fill="none" stroke="url(#goldGrad)" stroke-width="4" stroke-opacity="0.4" />

  <!-- Central Emblem Group with Shadow -->
  <g filter="url(#shadow)">
    <!-- Quran Stand (Rihal) / Open Book Base -->
    <!-- Left Page -->
    <path d="M256 360 C210 330 140 330 96 345 L96 175 C140 160 210 160 256 190 Z" fill="url(#pageGrad)" />
    <!-- Right Page -->
    <path d="M256 360 C302 330 372 330 416 345 L416 175 C372 160 302 160 256 190 Z" fill="url(#pageGrad)" />

    <!-- Book Spine / Center Fold -->
    <path d="M256 190 L256 360" stroke="#d97706" stroke-width="6" stroke-linecap="round" />

    <!-- Outer Book Binding / Cover Edge (Gold) -->
    <path d="M96 345 C140 330 210 330 256 360 C302 330 372 330 416 345 L416 358 C372 343 302 343 256 373 C210 343 140 343 96 358 Z" fill="url(#goldGrad)" />
    
    <!-- Quran Calligraphic lines / Page Text Simulation -->
    <g opacity="0.35" stroke="#065f46" stroke-width="3.5" stroke-linecap="round">
      <!-- Left page lines -->
      <line x1="130" y1="210" x2="225" y2="225" />
      <line x1="130" y1="240" x2="225" y2="255" />
      <line x1="130" y1="270" x2="225" y2="285" />
      <line x1="130" y1="300" x2="225" y2="315" />

      <!-- Right page lines -->
      <line x1="287" y1="225" x2="382" y2="210" />
      <line x1="287" y1="255" x2="382" y2="240" />
      <line x1="287" y1="285" x2="382" y2="270" />
      <line x1="287" y1="315" x2="382" y2="300" />
    </g>

    <!-- Islamic 8-pointed Star (Rub el Hizb) on top of the book -->
    <g transform="translate(256, 128) scale(0.65)">
      <!-- Star Square 1 -->
      <rect x="-42" y="-42" width="84" height="84" rx="6" fill="url(#goldGrad)" />
      <!-- Star Square 2 rotated 45 deg -->
      <rect x="-42" y="-42" width="84" height="84" rx="6" fill="url(#goldGrad)" transform="rotate(45)" />
      <!-- Central Inner Circle -->
      <circle r="24" fill="#065f46" />
      <!-- Golden Center Dot -->
      <circle r="9" fill="url(#goldGrad)" />
    </g>
  </g>

  <!-- App Title in Arabic at bottom: مُتْقِن -->
  <text x="256" y="445" text-anchor="middle" font-family="'Amiri', 'Tajawal', 'Traditional Arabic', serif" font-size="44" font-weight="bold" fill="#fef08a" letter-spacing="2">مُتْقِن</text>
</svg>`;

// Maskable SVG with safe 15% inner padding
const svgMaskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#065f46" />
      <stop offset="50%" stop-color="#047857" />
      <stop offset="100%" stop-color="#064e3b" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="pageGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#fef3c7" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Full-bleed background for maskable -->
  <rect width="512" height="512" fill="url(#bgGrad)" />

  <!-- Inner safe-zone circle guide (invisible background, elements scaled to fit 80% safe zone) -->
  <g transform="translate(256, 256) scale(0.78) translate(-256, -256)">
    <!-- Subtle inner border -->
    <rect x="20" y="20" width="472" height="472" rx="90" fill="none" stroke="url(#goldGrad)" stroke-width="4" stroke-opacity="0.4" />

    <!-- Central Emblem Group with Shadow -->
    <g filter="url(#shadow)">
      <!-- Quran Stand (Rihal) / Open Book Base -->
      <!-- Left Page -->
      <path d="M256 360 C210 330 140 330 96 345 L96 175 C140 160 210 160 256 190 Z" fill="url(#pageGrad)" />
      <!-- Right Page -->
      <path d="M256 360 C302 330 372 330 416 345 L416 175 C372 160 302 160 256 190 Z" fill="url(#pageGrad)" />

      <!-- Book Spine / Center Fold -->
      <path d="M256 190 L256 360" stroke="#d97706" stroke-width="6" stroke-linecap="round" />

      <!-- Outer Book Binding / Cover Edge (Gold) -->
      <path d="M96 345 C140 330 210 330 256 360 C302 330 372 330 416 345 L416 358 C372 343 302 343 256 373 C210 343 140 343 96 358 Z" fill="url(#goldGrad)" />
      
      <!-- Quran Calligraphic lines / Page Text Simulation -->
      <g opacity="0.35" stroke="#065f46" stroke-width="3.5" stroke-linecap="round">
        <line x1="130" y1="210" x2="225" y2="225" />
        <line x1="130" y1="240" x2="225" y2="255" />
        <line x1="130" y1="270" x2="225" y2="285" />
        <line x1="130" y1="300" x2="225" y2="315" />

        <line x1="287" y1="225" x2="382" y2="210" />
        <line x1="287" y1="255" x2="382" y2="240" />
        <line x1="287" y1="285" x2="382" y2="270" />
        <line x1="287" y1="315" x2="382" y2="300" />
      </g>

      <!-- Islamic 8-pointed Star -->
      <g transform="translate(256, 128) scale(0.65)">
        <rect x="-42" y="-42" width="84" height="84" rx="6" fill="url(#goldGrad)" />
        <rect x="-42" y="-42" width="84" height="84" rx="6" fill="url(#goldGrad)" transform="rotate(45)" />
        <circle r="24" fill="#065f46" />
        <circle r="9" fill="url(#goldGrad)" />
      </g>
    </g>

    <!-- App Title in Arabic at bottom: مُتْقِن -->
    <text x="256" y="445" text-anchor="middle" font-family="'Amiri', 'Tajawal', 'Traditional Arabic', serif" font-size="44" font-weight="bold" fill="#fef08a" letter-spacing="2">مُتْقِن</text>
  </g>
</svg>`;

async function run() {
  // Write SVGs
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgMaster, 'utf8');
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svgMaster, 'utf8');

  // Convert to PNGs using Sharp
  const svgBuffer = Buffer.from(svgMaster);
  const svgMaskableBuffer = Buffer.from(svgMaskable);

  // 1. 192x192
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));
  console.log('Created pwa-192x192.png');

  // 2. 512x512
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));
  console.log('Created pwa-512x512.png');

  // 3. 512x512 maskable
  await sharp(svgMaskableBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
  console.log('Created pwa-maskable-512x512.png');

  // 4. Apple Touch Icon 180x180
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Created apple-touch-icon.png');

  // 5. Favicon 48x48 PNG
  await sharp(svgBuffer)
    .resize(48, 48)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));
  console.log('Created favicon.png');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
