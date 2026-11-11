export interface QuantizedVector {
  readonly codes: Int8Array;
  readonly scale: number;
}

const levels = 127;

export const normalize = (vector: Float32Array) => {
  const length = Math.hypot(...vector);
  return length === 0
    ? vector
    : Float32Array.from(vector, (value) => value / length);
};

export const quantize = (vector: Float32Array): QuantizedVector => {
  const largest = vector.reduce(
    (max, value) => Math.max(max, Math.abs(value)),
    0,
  );
  const scale = largest === 0 ? 1 : largest / levels;
  return {
    codes: Int8Array.from(vector, (value) => Math.round(value / scale)),
    scale,
  };
};

export const dequantize = ({ codes, scale }: QuantizedVector) =>
  Float32Array.from(codes, (code) => code * scale);

export const codesToBlob = (codes: Int8Array) =>
  new Uint8Array(codes.buffer, codes.byteOffset, codes.byteLength);

export const blobToCodes = (blob: Uint8Array) =>
  new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);

export interface QuantizedMatrix {
  readonly dimensions: number;
  readonly codes: Int8Array;
  readonly scales: Float32Array;
}

export interface Neighbour {
  readonly row: number;
  readonly score: number;
}

const rowScore = (
  matrix: QuantizedMatrix,
  query: Float32Array,
  row: number,
) => {
  const { dimensions, codes } = matrix;
  const offset = row * dimensions;
  let sum = 0;
  for (let column = 0; column < dimensions; column++) {
    sum += (query[column] ?? 0) * (codes[offset + column] ?? 0);
  }
  return sum * (matrix.scales[row] ?? 0);
};

const insertRanked = (
  best: Array<Neighbour>,
  candidate: Neighbour,
  k: number,
) => {
  let index = best.length;
  while (index > 0 && (best[index - 1]?.score ?? 0) < candidate.score) index--;
  best.splice(index, 0, candidate);
  if (best.length > k) best.pop();
};

export const nearest = (
  matrix: QuantizedMatrix,
  query: Float32Array,
  rows: Iterable<number>,
  k: number,
): ReadonlyArray<Neighbour> => {
  const best: Array<Neighbour> = [];
  if (k <= 0) return best;
  for (const row of rows) {
    const score = rowScore(matrix, query, row);
    if (best.length < k || score > (best.at(-1)?.score ?? 0)) {
      insertRanked(best, { row, score }, k);
    }
  }
  return best;
};

export function* allRows(count: number) {
  for (let row = 0; row < count; row++) yield row;
}
