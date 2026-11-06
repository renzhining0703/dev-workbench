/**
 * server/lib/cipher.mjs 的类型声明（供前端测试跨端导入）
 * ⚠️ 与 src/lib/cipher.ts / server/lib/cipher.mjs 三处保持同步（漂移护栏）
 */
export declare const KDF_ITERATIONS: number
export declare class CipherError extends Error {}
export declare function encryptJson(master: string, data: unknown): Promise<string>
export declare function decryptJson<T = unknown>(master: string, blob: string): Promise<T>
