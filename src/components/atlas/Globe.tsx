"use client";

import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { MinusIcon, PlusIcon } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopology from "world-atlas/land-110m.json";
import { Button } from "@/components/ui/button";
import type { Pin } from "@/server/games/GameProtocol";
import { nextPin, pinAt, type PlacedPin } from "./pinNavigation";
import { paintPixelEarth, unitsPerCanvasPixel } from "./pixelEarth";

type Rotation = readonly [number, number];

const earthStyles = ["Realistic", "Pixel"] as const;
type EarthStyle = (typeof earthStyles)[number];

interface Drag {
  readonly x: number;
  readonly y: number;
  readonly from: Rotation;
  moved: boolean;
}

const size = 800;
const radius = 380;
const minZoom = 1;
const maxZoom = 16;
const dragThreshold = 4;
const touchReach = 22;
const pointerReach = 6;
const startRotation: Rotation = [30, -30];
const pixelViewsAcross = 3;
const pixelCanvasSize = (size * pixelViewsAcross) / unitsPerCanvasPixel;
const pixelCanvasSpan = `${pixelViewsAcross * 100}cqmin`;

const topology = landTopology as unknown as Topology<{
  land: GeometryCollection;
}>;
const land = feature(topology, topology.objects.land);
const graticule = geoGraticule10();

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const hundredths = (value: number) => Math.round(value * 100) / 100;

const pinRadius = (pin: Pin) =>
  hundredths(2.5 + 2.2 * Math.log10(pin.games + 1));

export const pinKey = (pin: Pin) => `${pin.placeQid}-${pin.kind}`;

const labelAnchor = (x: number) => (x < size / 2 ? "start" : "end");

const pinCaption = (pin: Pin) =>
  `${pin.label} · ${pin.games.toLocaleString("en")} ${pin.games === 1 ? "game" : "games"}${
    pin.kind === "country" ? " · studio city unknown" : ""
  }`;

export function Globe({
  pins,
  selected,
  onSelect,
}: {
  pins: ReadonlyArray<Pin>;
  selected: Pin | null;
  onSelect: (pin: Pin) => void;
}) {
  const [rotation, setRotation] = useState(startRotation);
  const [zoom, setZoom] = useState(minZoom);
  const [hovered, setHovered] = useState<Pin | null>(null);
  const [focused, setFocused] = useState<Pin | null>(null);
  const [earthStyle, setEarthStyle] = useState<EarthStyle>("Realistic");
  const drag = useRef<Drag | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const pixelated = earthStyle === "Pixel";
  const scale = radius * zoom;

  useEffect(() => {
    const context = canvas.current?.getContext("2d", {
      willReadFrequently: true,
    });
    if (!pixelated || !context) return;
    paintPixelEarth(context, land, rotation, scale / unitsPerCanvasPixel);
  }, [pixelated, rotation, scale]);
  const projection = geoOrthographic()
    .scale(scale)
    .translate([size / 2, size / 2])
    .rotate([rotation[0], rotation[1]])
    .clipAngle(90);
  const path = geoPath(projection);
  const center: [number, number] = [-rotation[0], -rotation[1]];

  const placed = pins.flatMap((pin): ReadonlyArray<PlacedPin> => {
    const coordinates: [number, number] = [pin.longitude, pin.latitude];
    if (geoDistance(coordinates, center) > Math.PI / 2 - 0.02) return [];
    const point = projection(coordinates);
    return point === null
      ? []
      : [{ pin, x: hundredths(point[0]), y: hundredths(point[1]) }];
  });
  const drawnRadius = (pin: Pin) =>
    pinRadius(pin) * (pin === selected ? 1.4 : 1);
  const label = placed.find(
    ({ pin }) => pin === (hovered ?? focused ?? selected),
  );
  const tabStop =
    placed.find(({ pin }) => pin === (focused ?? selected)) ?? placed[0];

  const onPinKeyDown = (
    event: KeyboardEvent<SVGCircleElement>,
    from: PlacedPin,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(from.pin);
      return;
    }
    const target = nextPin(placed, from, event.key);
    if (target === undefined) return;
    event.preventDefault();
    event.currentTarget.ownerSVGElement
      ?.querySelector<SVGCircleElement>(`[data-pin="${pinKey(target.pin)}"]`)
      ?.focus();
  };

  const unitsPerPixel = (svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    return size / Math.min(box.width, box.height);
  };

  const pinUnder = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const toSvg = svg.getScreenCTM()?.inverse();
    if (toSvg === undefined) return undefined;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      toSvg,
    );
    const minimumReach =
      (event.pointerType === "touch" ? touchReach : pointerReach) *
      unitsPerPixel(svg);
    return pinAt(placed, point.x, point.y, (pin) =>
      Math.max(drawnRadius(pin), minimumReach),
    );
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      from: rotation,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (current === null) {
      if (event.pointerType === "mouse")
        setHovered(pinUnder(event)?.pin ?? null);
      return;
    }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < dragThreshold) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const degrees =
      (unitsPerPixel(event.currentTarget) / scale) * (180 / Math.PI);
    setRotation([
      current.from[0] + dx * degrees,
      clamp(current.from[1] - dy * degrees, -90, 90),
    ]);
  };

  const endDrag = () => {
    drag.current = null;
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const tapped =
      drag.current !== null && !drag.current.moved && event.button === 0;
    endDrag();
    const target = tapped ? pinUnder(event) : undefined;
    if (target !== undefined) onSelect(target.pin);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    setZoom((current) =>
      clamp(current * Math.exp(-event.deltaY * 0.0015), minZoom, maxZoom),
    );
  };

  const zoomBy = (factor: number) => {
    setZoom((current) => clamp(current * factor, minZoom, maxZoom));
  };

  return (
    <div className="relative size-full overflow-hidden [container-type:size]">
      {pixelated && (
        <canvas
          ref={canvas}
          width={pixelCanvasSize}
          height={pixelCanvasSize}
          aria-hidden
          style={{ width: pixelCanvasSpan, height: pixelCanvasSpan }}
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 [image-rendering:pixelated]"
        />
      )}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="group"
        aria-label="Globe of video game studios. Use the arrow keys to move between places and Enter to open one."
        className={`relative size-full touch-none select-none ${
          hovered === null
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-pointer"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setHovered(null);
        }}
        onWheel={onWheel}
      >
        {!pixelated && (
          <>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={scale}
              fill="var(--globe-ocean)"
            />
            <path
              d={path(graticule) ?? undefined}
              fill="none"
              stroke="var(--globe-graticule)"
              strokeWidth={0.6}
            />
            <path d={path(land) ?? undefined} fill="var(--globe-land)" />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={scale}
              fill="none"
              stroke="var(--border)"
            />
          </>
        )}
        {placed.map((entry) => {
          const { pin, x, y } = entry;
          return (
            <circle
              key={pinKey(pin)}
              data-pin={pinKey(pin)}
              role="button"
              aria-label={pinCaption(pin)}
              tabIndex={entry === tabStop ? 0 : -1}
              cx={x}
              cy={y}
              r={drawnRadius(pin)}
              fill="var(--primary)"
              fillOpacity={
                pin === hovered ? 1 : pin.kind === "studio" ? 0.8 : 0.25
              }
              stroke={
                pin.kind === "studio" ? "var(--background)" : "var(--primary)"
              }
              strokeWidth={pin === selected ? 2 : 0.75}
              className="pointer-events-none transition-[r] outline-none focus-visible:[fill-opacity:1] focus-visible:[stroke-width:3] focus-visible:[stroke:var(--foreground)]"
              onFocus={() => {
                setFocused(pin);
              }}
              onBlur={() => {
                setFocused(null);
              }}
              onKeyDown={(event) => {
                onPinKeyDown(event, entry);
              }}
              onClick={() => {
                onSelect(pin);
              }}
            >
              <title>{pinCaption(pin)}</title>
            </circle>
          );
        })}
        {label !== undefined && (
          <text
            x={label.x}
            y={label.y - pinRadius(label.pin) - 8}
            textAnchor={labelAnchor(label.x)}
            fill="var(--foreground)"
            stroke="var(--background)"
            strokeWidth={4}
            paintOrder="stroke"
            className="pointer-events-none text-[15px] font-medium"
          >
            {pinCaption(label.pin)}
          </text>
        )}
      </svg>
      <div className="absolute bottom-3 left-3 flex flex-col gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => {
            zoomBy(1.5);
          }}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => {
            zoomBy(1 / 1.5);
          }}
        >
          <MinusIcon />
        </Button>
      </div>
      <div
        role="group"
        aria-label="Earth style"
        className="absolute top-3 right-3 flex gap-0.5 rounded-lg border bg-background p-0.5"
      >
        {earthStyles.map((style) => (
          <Button
            key={style}
            variant={style === earthStyle ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={style === earthStyle}
            onClick={() => {
              setEarthStyle(style);
            }}
          >
            {style}
          </Button>
        ))}
      </div>
    </div>
  );
}
