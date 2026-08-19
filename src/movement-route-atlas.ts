/**
 * Stores sampled movement loops once for shared CPU and GPU playback.
 * The atlas is immutable after creation; route generation belongs to domain-specific modules.
 */

import {
  DataTexture,
  FloatType,
  type Matrix4,
  NearestFilter,
  RGBAFormat,
} from "three";

export type RoutePoint = Readonly<{
  x: number;
  z: number;
}>;

export type MovementRouteHandle = Readonly<{
  index: number;
  duration: number;
}>;

type RouteInterpolation = Readonly<{
  firstOffset: number;
  secondOffset: number;
  blend: number;
}>;

export class MovementRouteAtlas {
  readonly texture: DataTexture;
  readonly routeCount: number;
  readonly sampleCount: number;
  readonly routeHandles: readonly MovementRouteHandle[];

  private readonly routeSampleData: Float32Array;

  constructor(routes: readonly (readonly RoutePoint[])[], maximumSpeed: number) {
    this.routeCount = routes.length;
    this.sampleCount = routes[0]!.length;
    this.routeSampleData = createRouteSampleData(routes);
    const sharedDuration = getLongestClosedLength(routes) / maximumSpeed;
    this.routeHandles = routes.map((_, index) => ({ index, duration: sharedDuration }));
    this.texture = createRouteTexture(this.routeSampleData, this.sampleCount, this.routeCount);
  }

  writeMatrixAtTime(handle: MovementRouteHandle, time: number, target: Matrix4): void {
    const sample = wrap01(time / handle.duration) * this.sampleCount;
    const first = Math.floor(sample) % this.sampleCount;
    const second = (first + 1) % this.sampleCount;
    const blend = sample - Math.floor(sample);
    const firstOffset = getOffset(handle.index, first, this.sampleCount);
    const secondOffset = getOffset(handle.index, second, this.sampleCount);
    writeInterpolatedMatrix(target, this.routeSampleData, { firstOffset, secondOffset, blend });
  }

  dispose(): void {
    this.texture.dispose();
  }
}

function createRouteSampleData(routes: readonly (readonly RoutePoint[])[]): Float32Array {
  const sampleCount = routes[0]!.length;
  const routeSampleData = new Float32Array(routes.length * sampleCount * 4);
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    writeRouteSampleData(routeSampleData, routes[routeIndex]!, routeIndex);
  }
  return routeSampleData;
}

function writeRouteSampleData(
  routeSampleData: Float32Array,
  route: readonly RoutePoint[],
  routeIndex: number,
): void {
  for (let index = 0; index < route.length; index += 1) {
    const previous = route[(index - 1 + route.length) % route.length]!;
    const point = route[index]!;
    const next = route[(index + 1) % route.length]!;
    const directionLength = Math.hypot(next.x - previous.x, next.z - previous.z) || 1;
    const offset = getOffset(routeIndex, index, route.length);
    routeSampleData.set(
      [
        point.x,
        point.z,
        (next.x - previous.x) / directionLength,
        (next.z - previous.z) / directionLength,
      ],
      offset,
    );
  }
}

function createRouteTexture(
  routeSampleData: Float32Array,
  width: number,
  height: number,
): DataTexture {
  const texture = new DataTexture(routeSampleData, width, height, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function writeInterpolatedMatrix(
  target: Matrix4,
  routeSampleData: Float32Array,
  interpolation: RouteInterpolation,
): void {
  const { firstOffset, secondOffset, blend } = interpolation;
  const x = lerp(routeSampleData[firstOffset]!, routeSampleData[secondOffset]!, blend);
  const z = lerp(routeSampleData[firstOffset + 1]!, routeSampleData[secondOffset + 1]!, blend);
  const directionX = lerp(
    routeSampleData[firstOffset + 2]!,
    routeSampleData[secondOffset + 2]!,
    blend,
  );
  const directionZ = lerp(
    routeSampleData[firstOffset + 3]!,
    routeSampleData[secondOffset + 3]!,
    blend,
  );
  target.makeRotationY(Math.atan2(directionX, directionZ));
  target.setPosition(x, 0, z);
}

function getLongestClosedLength(routes: readonly (readonly RoutePoint[])[]): number {
  return routes.reduce((longest, route) => Math.max(longest, getClosedLength(route)), 0);
}

function getClosedLength(route: readonly RoutePoint[]): number {
  let length = 0;
  for (let index = 0; index < route.length; index += 1) {
    length += distance(route[index]!, route[(index + 1) % route.length]!);
  }
  return length;
}

function getOffset(routeIndex: number, sampleIndex: number, sampleCount: number): number {
  return (routeIndex * sampleCount + sampleIndex) * 4;
}

function distance(first: RoutePoint, second: RoutePoint): number {
  return Math.hypot(second.x - first.x, second.z - first.z);
}

function lerp(first: number, second: number, blend: number): number {
  return first + (second - first) * blend;
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}
