import type { Box } from './types';

export function overlaps(a: Box, b: Box, inflate = 0): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + inflate &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + inflate &&
    Math.abs(a.z - b.z) * 2 < a.d + b.d + inflate
  );
}
