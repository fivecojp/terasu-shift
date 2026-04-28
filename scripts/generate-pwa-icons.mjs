import sharp from 'sharp'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svgPath = join(root, 'public', 'icons', 'icon.svg')
const svg = readFileSync(svgPath)

for (const size of [192, 512]) {
  const out = join(root, 'public', 'icons', `icon-${size}x${size}.png`)
  await sharp(svg).resize(size, size).png().toFile(out)
  console.log('wrote', out)
}
