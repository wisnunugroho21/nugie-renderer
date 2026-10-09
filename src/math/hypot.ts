/**
 * Euclidean length helpers. `Math.hypot` is about 8x slower than `Math.sqrt` of the sum of squares in V8 (it guards against overflow and
 * underflow), which shows up in per-node / per-object loops; engine values never get near those limits.
 */
export const hypot2 = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const hypot3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);
export const hypot4 = (x: number, y: number, z: number, w: number): number => Math.sqrt(x * x + y * y + z * z + w * w);
