#!/usr/bin/env node
/**
 * Hero image processing script.
 * Drop a high-resolution source image (e.g. hero-source.jpg) into public/img/hero-src/
 * Recommended: 3200px wide, landscape, 2:1 aspect (e.g. 3200x1600) with room for cropping.
 * The script will output optimized WebP + JPEG variants (640, 1024, 1600) and a tiny placeholder.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SRC_DIR = path.resolve('public/img/hero-src');
const OUT_DIR = path.resolve('public/img/hero');
const PLACEHOLDER = path.resolve(OUT_DIR, 'hero-toronto-placeholder.webp');
const BASENAME = 'hero-toronto';
const SIZES = [640, 1024, 1600];

async function run() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('Source directory not found:', SRC_DIR);
    process.exit(1);
  }
  const candidates = fs.readdirSync(SRC_DIR).filter(f => /hero-source\.(jpe?g|png)$/i.test(f));
  if (!candidates.length) {
    console.error('No source image named hero-source.(jpg|jpeg|png) found in', SRC_DIR);
    process.exit(1);
  }
  const src = path.join(SRC_DIR, candidates[0]);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const image = sharp(src).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    console.error('Cannot read image dimensions');
    process.exit(1);
  }
  const aspectTarget = 2 / 1; // 2:1
  const aspect = metadata.width / metadata.height;
  let pipeline = image.clone();
  // Center crop to 2:1 if needed
  if (Math.abs(aspect - aspectTarget) > 0.01) {
    const targetWidth = metadata.width;
    const targetHeight = Math.round(targetWidth / aspectTarget);
    if (targetHeight <= metadata.height) {
      const top = Math.round((metadata.height - targetHeight) / 2);
      pipeline = pipeline.extract({ left: 0, top, width: targetWidth, height: targetHeight });
    } else {
      const targetHeight2 = metadata.height;
      const targetWidth2 = Math.round(targetHeight2 * aspectTarget);
      const left = Math.round((metadata.width - targetWidth2) / 2);
      pipeline = pipeline.extract({ left, top: 0, width: targetWidth2, height: targetHeight2 });
    }
  }

  // produce variants
  for (const w of SIZES) {
    const base = path.join(OUT_DIR, `${BASENAME}-${w}`);
    await pipeline.clone().resize(w).webp({ quality: 70 }).toFile(base + '.webp');
    await pipeline.clone().resize(w).jpeg({ quality: 78, mozjpeg: true }).toFile(base + '.jpg');
    console.log('Generated', base);
  }

  // placeholder (blurred tiny)
  await pipeline.clone().resize(64).webp({ quality: 40 }).toFile(PLACEHOLDER);
  console.log('Placeholder created:', PLACEHOLDER);
  console.log('Done. Add generated files to git: public/img/hero/*.webp and *.jpg');
}

run().catch(e => { console.error(e); process.exit(1); });
