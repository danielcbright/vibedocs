// Rasterises the master icon SVG (frontend/scripts/icon-source.svg) into the
// PWA icon set under frontend/public/. Re-run after editing icon-source.svg.
//
//   node frontend/scripts/generate-icons.mjs
//
// `sharp` is a devDependency. The generated PNGs ARE committed (so a plain
// `npm run build` / deploy doesn't need sharp), but this script is the
// reproducible source of truth for how they were made.
import sharp from 'sharp'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'icon-source.svg')
const OUT = path.join(here, '..', 'public')

// Standard (any-purpose) icons render the source full-bleed.
const PNG_TARGETS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

// Brand background extracted from the master SVG's <rect fill="…">, reused for
// the maskable icon's padding so the safe-zone inset is seamless. Keep this in
// sync with the <rect> fill in icon-source.svg (and the manifest background_color).
const BRAND_BG = '#020817'

async function main() {
  await mkdir(OUT, { recursive: true })
  const svg = await readFile(SRC)

  for (const { file, size } of PNG_TARGETS) {
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(path.join(OUT, file))
    console.log(`  wrote ${file} (${size}x${size})`)
  }

  // Maskable icon: the monogram must survive Android's adaptive-icon crop,
  // which can shave up to ~20% off each edge. Render the source at 80% and
  // pad with the brand background so the "VD" stays inside the safe zone.
  const inner = Math.round(512 * 0.8)
  const pad = Math.round((512 - inner) / 2)
  const innerPng = await sharp(svg, { density: 384 }).resize(inner, inner, { fit: 'cover' }).png().toBuffer()
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: BRAND_BG },
  })
    .composite([{ input: innerPng, top: pad, left: pad }])
    .png()
    .toFile(path.join(OUT, 'icon-maskable-512.png'))
  console.log('  wrote icon-maskable-512.png (512x512, padded safe zone)')

  // favicon.svg is the master SVG itself (modern browsers prefer it).
  await writeFile(path.join(OUT, 'favicon.svg'), svg)
  console.log('  wrote favicon.svg')

  // favicon.ico: pack 16/32/48 PNG frames into a single .ico container.
  const ico = await buildIco([16, 32, 48], svg)
  await writeFile(path.join(OUT, 'favicon.ico'), ico)
  console.log('  wrote favicon.ico')
}

// Minimal ICO encoder: PNG-compressed frames (supported by all modern browsers).
async function buildIco(sizes, svg) {
  const frames = await Promise.all(
    sizes.map(async (size) => ({
      size,
      png: await sharp(svg, { density: 384 }).resize(size, size, { fit: 'cover' }).png().toBuffer(),
    })),
  )

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)

  const dirEntries = []
  const imageData = []
  let offset = 6 + frames.length * 16

  for (const { size, png } of frames) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 => 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    dirEntries.push(entry)
    imageData.push(png)
    offset += png.length
  }

  return Buffer.concat([header, ...dirEntries, ...imageData])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
