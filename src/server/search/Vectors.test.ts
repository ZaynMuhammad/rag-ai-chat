import { assert, describe, it } from "@effect/vitest";
import {
  allRows,
  blobToCodes,
  codesToBlob,
  dequantize,
  nearest,
  normalize,
  quantize,
} from "./Vectors";

const dimensions = 384;

const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
};

const unitVector = (next: () => number) =>
  normalize(Float32Array.from({ length: dimensions }, next));

const dot = (a: Float32Array, b: Float32Array) =>
  a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

describe("quantize", () => {
  it("keeps every component within half a step of the original", () => {
    const next = seeded(1);
    for (let sample = 0; sample < 50; sample++) {
      const vector = unitVector(next);
      const quantized = quantize(vector);
      const restored = dequantize(quantized);
      for (const [index, value] of vector.entries()) {
        assert.isAtMost(
          Math.abs(value - (restored[index] ?? 0)),
          quantized.scale / 2 + 1e-7,
        );
      }
    }
  });

  it("moves a unit-query dot product by at most sqrt(d) times half a step", () => {
    const next = seeded(2);
    for (let sample = 0; sample < 50; sample++) {
      const passage = unitVector(next);
      const query = unitVector(next);
      const quantized = quantize(passage);
      const error = Math.abs(
        dot(query, passage) - dot(query, dequantize(quantized)),
      );
      assert.isAtMost(error, (Math.sqrt(dimensions) * quantized.scale) / 2);
      assert.isAtMost(error, 0.01);
    }
  });

  it("uses the full int8 range for the largest component", () => {
    const { codes } = quantize(Float32Array.of(0.5, -1, 0.25));
    assert.deepStrictEqual([...codes], [64, -127, 32]);
  });

  it("round-trips a zero vector without dividing by zero", () => {
    const quantized = quantize(new Float32Array(4));
    assert.deepStrictEqual([...dequantize(quantized)], [0, 0, 0, 0]);
  });

  it("stores codes as bytes and reads the same codes back", () => {
    const { codes } = quantize(Float32Array.of(0.1, -0.9, 0.4));
    assert.deepStrictEqual([...blobToCodes(codesToBlob(codes))], [...codes]);
  });
});

describe("nearest", () => {
  const rows = [
    Float32Array.of(1, 0),
    Float32Array.of(0, 1),
    Float32Array.of(0.6, 0.8),
    Float32Array.of(-1, 0),
  ].map(quantize);
  const matrix = {
    dimensions: 2,
    codes: Int8Array.from(rows.flatMap(({ codes }) => [...codes])),
    scales: Float32Array.from(rows.map(({ scale }) => scale)),
  };

  it("returns the k highest dot products, best first", () => {
    assert.deepStrictEqual(
      nearest(matrix, Float32Array.of(0.8, 0.6), allRows(4), 3).map(
        ({ row }) => row,
      ),
      [2, 0, 1],
    );
  });

  it("only scores the rows it is given", () => {
    assert.deepStrictEqual(
      nearest(matrix, Float32Array.of(0.8, 0.6), [1, 3], 3).map(
        ({ row }) => row,
      ),
      [1, 3],
    );
  });

  it("returns nothing for k of zero", () => {
    assert.deepStrictEqual(
      nearest(matrix, Float32Array.of(1, 0), allRows(4), 0),
      [],
    );
  });
});
