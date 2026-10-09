export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

/**
 * Unit cube (-0.5..0.5) with 4 vertices per face so each face has a flat normal.
 * Face f uses vertices 4f..4f+3 in loop order, which the Canvas2D renderer relies on.
 */
export function buildCube(): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  for (const n of faces) {
    const u = Math.abs(n[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const base = positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) positions.push(0.5 * (n[k] + a * u[k] + b * v[k]));
      normals.push(n[0], n[1], n[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

/** Subdivided XZ plane; needs real vertices along Z for the curved-world bend to show. */
export function buildGroundGrid(xMin: number, xMax: number, zMin: number, zMax: number, nx: number, nz: number): { positions: Float32Array; indices: Uint16Array } {
  const positions = new Float32Array((nx + 1) * (nz + 1) * 2);
  let p = 0;
  for (let j = 0; j <= nz; j++) {
    const z = zMin + ((zMax - zMin) * j) / nz;
    for (let i = 0; i <= nx; i++) {
      positions[p++] = xMin + ((xMax - xMin) * i) / nx;
      positions[p++] = z;
    }
  }
  const indices = new Uint16Array(nx * nz * 6);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + nx + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = b; indices[k++] = b + 1;
    }
  }
  return { positions, indices };
}
