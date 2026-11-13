import { type GeoPermissibleObjects, geoOrthographic, geoPath } from "d3-geo";

type Rgb = readonly [number, number, number];
type Palette = readonly [Rgb, Rgb, Rgb];

export const unitsPerCanvasPixel = 5;

const lightOrigin = 0.39;
const lightBorders = [0.4, 0.6] as const;
const ocean: Palette = [
  [146, 232, 192],
  [79, 164, 184],
  [44, 53, 77],
];
const land: Palette = [
  [99, 171, 63],
  [47, 87, 83],
  [40, 53, 64],
];
const sunlitCoast: Rgb = [200, 212, 93];

const lightBand = (light: number, ditherWidth: number, dithered: boolean) => {
  const crossed = (border: number) =>
    light > border && !(dithered && light < border + ditherWidth);
  if (crossed(lightBorders[1])) return 2;
  if (crossed(lightBorders[0])) return 1;
  return 0;
};

export function paintPixelEarth(
  context: CanvasRenderingContext2D,
  landShape: GeoPermissibleObjects,
  rotation: readonly [number, number],
  radius: number,
) {
  const size = context.canvas.width;
  const projection = geoOrthographic()
    .scale(radius)
    .translate([size / 2, size / 2])
    .rotate([rotation[0], rotation[1]])
    .clipAngle(90);

  context.clearRect(0, 0, size, size);
  context.beginPath();
  geoPath(projection, context)(landShape);
  context.fill();

  const image = context.getImageData(0, 0, size, size);
  const pixels = image.data;
  const landMask = new Uint8Array(size * size);
  for (let pixel = 0; pixel < landMask.length; pixel++) {
    landMask[pixel] = (pixels[pixel * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  }
  const isLand = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && landMask[y * size + x] === 1;
  const ditherWidth = 1 / radius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const dx = x + 0.5 - size / 2;
      const dy = y + 0.5 - size / 2;
      if (dx * dx + dy * dy > radius * radius) {
        pixels[index + 3] = 0;
        continue;
      }
      const lx = 0.5 + dx / (2 * radius) - lightOrigin;
      const ly = 0.5 + dy / (2 * radius) - lightOrigin;
      const light = Math.sqrt(lx * lx + ly * ly);
      const shade = lightBand(light, ditherWidth, (x + y) % 2 === 0);
      const color = !isLand(x, y)
        ? ocean[shade]
        : shade === 0 && !isLand(x - 1, y - 1)
          ? sunlitCoast
          : land[shade];
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}
