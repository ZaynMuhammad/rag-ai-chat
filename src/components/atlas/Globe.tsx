"use client";

import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { MinusIcon, PlusIcon } from "lucide-react";
import { type PointerEvent, type WheelEvent, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopology from "world-atlas/land-110m.json";
import { Button } from "@/components/ui/button";
import type { Pin } from "@/server/games/GameProtocol";

type Rotation = readonly [number, number];

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
const startRotation: Rotation = [30, -30];

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
  const drag = useRef<Drag | null>(null);

  const scale = radius * zoom;
  const projection = geoOrthographic()
    .scale(scale)
    .translate([size / 2, size / 2])
    .rotate([rotation[0], rotation[1]])
    .clipAngle(90);
  const path = geoPath(projection);
  const center: [number, number] = [-rotation[0], -rotation[1]];

  const placed = pins.flatMap((pin) => {
    const coordinates: [number, number] = [pin.longitude, pin.latitude];
    if (geoDistance(coordinates, center) > Math.PI / 2 - 0.02) return [];
    const point = projection(coordinates);
    return point === null
      ? []
      : [{ pin, x: hundredths(point[0]), y: hundredths(point[1]) }];
  });
  const label = placed.find(({ pin }) => pin === (hovered ?? selected));

  const unitsPerPixel = (svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    return size / Math.min(box.width, box.height);
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
    if (current === null) return;
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

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    setZoom((current) =>
      clamp(current * Math.exp(-event.deltaY * 0.0015), minZoom, maxZoom),
    );
  };

  const zoomBy = (factor: number) => {
    setZoom((current) => clamp(current * factor, minZoom, maxZoom));
  };

  return (
    <div className="relative size-full">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Globe of video game studios"
        className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
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
        {placed.map(({ pin, x, y }) => (
          <circle
            key={pinKey(pin)}
            cx={x}
            cy={y}
            r={pinRadius(pin) * (pin === selected ? 1.4 : 1)}
            fill="var(--primary)"
            fillOpacity={pin.kind === "studio" ? 0.8 : 0.25}
            stroke={
              pin.kind === "studio" ? "var(--background)" : "var(--primary)"
            }
            strokeWidth={pin === selected ? 2 : 0.75}
            className="cursor-pointer transition-[r] hover:[fill-opacity:1]"
            onPointerEnter={() => {
              setHovered(pin);
            }}
            onPointerLeave={() => {
              setHovered(null);
            }}
            onClick={() => {
              onSelect(pin);
            }}
          >
            <title>{pinCaption(pin)}</title>
          </circle>
        ))}
        {label !== undefined && (
          <text
            x={label.x}
            y={label.y - pinRadius(label.pin) - 8}
            textAnchor="middle"
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
    </div>
  );
}
