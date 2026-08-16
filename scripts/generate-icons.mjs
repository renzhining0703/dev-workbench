/**
 * 一次性 PWA 图标生成脚本
 *   - 输入：public/favicon.svg
 *   - 输出：public/pwa-192x192.png、public/pwa-512x512.png、
 *           public/pwa-maskable-512.png、public/apple-touch-icon.png
 *
 * 用法：node scripts/generate-icons.mjs（或 npm run gen:icons）
 *
 * 设计要点：
 *   - 普通 192/512：直接缩放，保留 svg 原样
 *   - maskable：safe zone 80%（中心 410×410），外圈 10% 同品牌色填充，
 *     适配 Android adaptive launcher 的圆形/圆角/teardrop 裁切
 *   - apple-touch-icon：180×180，iOS 不接受透明背景，sharp 默认会保留原 svg 的紫色背景
 */
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SVG_PATH = join(ROOT, 'public/favicon.svg')
const OUT_DIR = join(ROOT, 'public')

const svg = readFileSync(SVG_PATH)
console.log('Source:', SVG_PATH)
console.log('SVG bytes:', svg.length)

async function run() {
  // 普通图标（Chrome / Android / 桌面 PWA）
  await sharp(svg).resize(192, 192).png().toFile(join(OUT_DIR, 'pwa-192x192.png'))
  console.log('  ✓ pwa-192x192.png')

  await sharp(svg).resize(512, 512).png().toFile(join(OUT_DIR, 'pwa-512x512.png'))
  console.log('  ✓ pwa-512x512.png')

  // maskable：80% 内容 + 10% 边距 + 同色 #6366f1 背景填充
  // （resize 到 410，再 extend 各边 51 → 总 512）
  await sharp(svg)
    .resize(410, 410)
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: { r: 99, g: 102, b: 241 }, // #6366f1
    })
    .png()
    .toFile(join(OUT_DIR, 'pwa-maskable-512.png'))
  console.log('  ✓ pwa-maskable-512.png (safe zone 80%)')

  // iOS apple-touch-icon
  await sharp(svg).resize(180, 180).png().toFile(join(OUT_DIR, 'apple-touch-icon.png'))
  console.log('  ✓ apple-touch-icon.png')

  console.log('\nDone. 4 PWA icons written to public/.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})