/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// 前端单测：node 环境（被测纯函数零 DOM 依赖，无需 jsdom）
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
})
