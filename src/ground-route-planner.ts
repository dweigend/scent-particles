/**
 * Plans closed ground routes around circular footprints and other moving routes.
 * Planning is bounded setup work; runtime steering and physics are intentionally excluded.
 */

import type { GroundFootprint } from "./ground-footprints";
import type { RoutePoint } from "./movement-route-atlas";

export type GroundRoutePlanSettings = Readonly<{
  routeCount: number;
  moverRadius: number;
  clearance: number;
}>;

const CONTROL_POINT_COUNT = 64;
const ROUTE_SAMPLE_COUNT = 256;
const RELAXATION_STEPS = 20;
const CANDIDATE_ATTEMPTS = 18;
const MAXIMUM_ROUTE_RADIUS = 13.25;
const FALLBACK_RADIUS_STEP = 0.1;

type MutablePoint = { x: number; z: number };

type RadialRouteSettings = Readonly<{
  baseRadius: number;
  routePhase: number;
  firstWavePhase: number;
  secondWavePhase: number;
  centerX: number;
  centerZ: number;
}>;

type SegmentSample = Readonly<{
  route: readonly RoutePoint[];
  segmentLengths: readonly number[];
  segmentIndex: number;
  segmentStartDistance: number;
  targetDistance: number;
}>;

type RouteSearchContext = Readonly<{
  footprints: readonly GroundFootprint[];
  plannedRoutes: readonly (readonly RoutePoint[])[];
  settings: GroundRoutePlanSettings;
}>;

type RouteCandidateIndex = Readonly<{
  routeIndex: number;
  attempt: number;
}>;

export function planGroundRoutes(
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
): readonly (readonly RoutePoint[])[] {
  const routes: (readonly RoutePoint[])[] = [];
  for (let routeIndex = 0; routeIndex < settings.routeCount; routeIndex += 1) {
    const route = findRoute({ footprints, plannedRoutes: routes, settings }, routeIndex);
    if (!route) return createFallbackRoutes(footprints, settings);
    routes.push(route);
  }
  return routes;
}

function findRoute(
  context: RouteSearchContext,
  routeIndex: number,
): readonly RoutePoint[] | undefined {
  for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt += 1) {
    const candidate = createCandidateRoute(context.footprints, context.settings, {
      routeIndex,
      attempt,
    });
    relaxRoute(candidate, context.footprints, context.settings);
    const route = resampleClosedRoute(candidate, ROUTE_SAMPLE_COUNT);
    if (isRouteValid(route, context)) return route;
  }
  return undefined;
}

function createCandidateRoute(
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
  candidateIndex: RouteCandidateIndex,
): MutablePoint[] {
  const extent = getFootprintExtent(footprints);
  const phaseStep = (Math.PI * 2) / settings.routeCount;
  return createRadialRoute({
    baseRadius: Math.min(
      8.8,
      Math.max(3.8, extent * 0.72 + candidateIndex.attempt * 0.12),
    ),
    routePhase: candidateIndex.routeIndex * phaseStep + Math.random() * 0.16,
    firstWavePhase: Math.random() * Math.PI * 2,
    secondWavePhase: Math.random() * Math.PI * 2,
    centerX: (Math.random() - 0.5) * 0.8,
    centerZ: (Math.random() - 0.5) * 0.8,
  });
}

function createRadialRoute(settings: RadialRouteSettings): MutablePoint[] {
  return Array.from({ length: CONTROL_POINT_COUNT }, (_, index) => {
    const angle = settings.routePhase + (index / CONTROL_POINT_COUNT) * Math.PI * 2;
    const radius =
      settings.baseRadius +
      Math.sin(angle * 2 + settings.firstWavePhase) * 1.25 +
      Math.sin(angle * 5 + settings.secondWavePhase) * 0.55;
    return {
      x: settings.centerX + Math.cos(angle) * radius,
      z: settings.centerZ + Math.sin(angle) * radius,
    };
  });
}

function relaxRoute(
  route: MutablePoint[],
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
): void {
  for (let step = 0; step < RELAXATION_STEPS; step += 1) {
    smoothClosedRoute(route);
    for (const point of route) pushOutsideFootprints(point, footprints, settings);
    for (const point of route) constrainToWorld(point);
  }
}

function smoothClosedRoute(route: MutablePoint[]): void {
  const snapshot = route.map(({ x, z }) => ({ x, z }));
  for (let index = 0; index < route.length; index += 1) {
    const previous = snapshot[(index - 1 + route.length) % route.length]!;
    const current = snapshot[index]!;
    const next = snapshot[(index + 1) % route.length]!;
    route[index]!.x = current.x * 0.7 + (previous.x + next.x) * 0.15;
    route[index]!.z = current.z * 0.7 + (previous.z + next.z) * 0.15;
  }
}

function pushOutsideFootprints(
  point: MutablePoint,
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
): void {
  for (const footprint of footprints) {
    const minimumDistance = getFootprintClearanceRadius(footprint, settings);
    const deltaX = point.x - footprint.centerX;
    const deltaZ = point.z - footprint.centerZ;
    const distanceToCenter = Math.hypot(deltaX, deltaZ);
    if (distanceToCenter >= minimumDistance) continue;
    if (distanceToCenter < 0.0001) {
      point.x = footprint.centerX + minimumDistance;
      point.z = footprint.centerZ;
      continue;
    }
    const inverseDistance = 1 / Math.max(distanceToCenter, 0.0001);
    point.x = footprint.centerX + deltaX * inverseDistance * minimumDistance;
    point.z = footprint.centerZ + deltaZ * inverseDistance * minimumDistance;
  }
}

function constrainToWorld(point: MutablePoint): void {
  const radius = Math.hypot(point.x, point.z);
  if (radius <= MAXIMUM_ROUTE_RADIUS) return;
  point.x *= MAXIMUM_ROUTE_RADIUS / radius;
  point.z *= MAXIMUM_ROUTE_RADIUS / radius;
}

function createFallbackRoutes(
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
): readonly (readonly RoutePoint[])[] {
  const minimumRadius = Math.max(
    getRequiredOuterRadius(footprints, settings),
    getRequiredGroupRadius(settings),
  );
  for (
    let radius = minimumRadius;
    radius <= MAXIMUM_ROUTE_RADIUS;
    radius += FALLBACK_RADIUS_STEP
  ) {
    const routes = createPhasedCircleRoutes(settings.routeCount, radius);
    const valid = routes.every((route, index) =>
      isRouteValid(route, {
        footprints,
        plannedRoutes: routes.slice(0, index),
        settings,
      }),
    );
    if (valid) return routes;
  }
  throw new Error("Keine sichere Bodenroute.");
}

function createPhasedCircleRoutes(
  routeCount: number,
  radius: number,
): readonly (readonly RoutePoint[])[] {
  return Array.from({ length: routeCount }, (_, routeIndex) => {
    const phase = (routeIndex / routeCount) * Math.PI * 2;
    return Array.from({ length: ROUTE_SAMPLE_COUNT }, (__, sampleIndex) => {
      const angle = phase + (sampleIndex / ROUTE_SAMPLE_COUNT) * Math.PI * 2;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    });
  });
}

function resampleClosedRoute(
  route: readonly RoutePoint[],
  sampleCount: number,
): readonly RoutePoint[] {
  const segmentLengths = route.map((point, index) =>
    distance(point, route[(index + 1) % route.length]!),
  );
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const samples: RoutePoint[] = [];
  let segmentIndex = 0;
  let segmentStartDistance = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const targetDistance = (index / sampleCount) * totalLength;
    while (segmentStartDistance + segmentLengths[segmentIndex]! < targetDistance) {
      segmentStartDistance += segmentLengths[segmentIndex]!;
      segmentIndex = (segmentIndex + 1) % route.length;
    }
    samples.push(
      interpolateSegment({
        route,
        segmentLengths,
        segmentIndex,
        segmentStartDistance,
        targetDistance,
      }),
    );
  }
  return samples;
}

function interpolateSegment(sample: SegmentSample): RoutePoint {
  const start = sample.route[sample.segmentIndex]!;
  const end = sample.route[(sample.segmentIndex + 1) % sample.route.length]!;
  const blend =
    (sample.targetDistance - sample.segmentStartDistance) /
    Math.max(sample.segmentLengths[sample.segmentIndex]!, 0.0001);
  return {
    x: start.x + (end.x - start.x) * blend,
    z: start.z + (end.z - start.z) * blend,
  };
}

function isRouteValid(
  route: readonly RoutePoint[],
  context: RouteSearchContext,
): boolean {
  return (
    isClearOfFootprints(route, context.footprints, context.settings) &&
    context.plannedRoutes.every((plannedRoute) =>
      routesRemainSeparated(route, plannedRoute, context.settings),
    )
  );
}

function isClearOfFootprints(
  route: readonly RoutePoint[],
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
): boolean {
  return route.every((point, index) => {
    const next = route[(index + 1) % route.length]!;
    return footprints.every(
      (footprint) =>
        distanceFromFootprintToSegment(footprint, point, next) >=
        getFootprintClearanceRadius(footprint, settings),
    );
  });
}

function routesRemainSeparated(
  firstRoute: readonly RoutePoint[],
  secondRoute: readonly RoutePoint[],
  settings: GroundRoutePlanSettings,
): boolean {
  const minimumDistance = settings.moverRadius * 2 + settings.clearance;
  return firstRoute.every((firstPoint, index) => {
    const secondPoint = secondRoute[index]!;
    const firstNext = firstRoute[(index + 1) % firstRoute.length]!;
    const secondNext = secondRoute[(index + 1) % secondRoute.length]!;
    return (
      distanceFromOriginToSegment(
        { x: firstPoint.x - secondPoint.x, z: firstPoint.z - secondPoint.z },
        { x: firstNext.x - secondNext.x, z: firstNext.z - secondNext.z },
      ) >= minimumDistance
    );
  });
}

function distanceFromFootprintToSegment(
  footprint: GroundFootprint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  return distanceFromOriginToSegment(
    { x: start.x - footprint.centerX, z: start.z - footprint.centerZ },
    { x: end.x - footprint.centerX, z: end.z - footprint.centerZ },
  );
}

function distanceFromOriginToSegment(start: RoutePoint, end: RoutePoint): number {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  const blend = Math.min(
    1,
    Math.max(
      0,
      -(start.x * segmentX + start.z * segmentZ) / Math.max(lengthSquared, 0.0001),
    ),
  );
  return Math.hypot(start.x + segmentX * blend, start.z + segmentZ * blend);
}

function getFootprintExtent(footprints: readonly GroundFootprint[]): number {
  return footprints.reduce(
    (extent, footprint) =>
      Math.max(extent, Math.hypot(footprint.centerX, footprint.centerZ) + footprint.radius),
    0,
  );
}

function getRequiredOuterRadius(
  footprints: readonly GroundFootprint[],
  settings: GroundRoutePlanSettings,
): number {
  return footprints.reduce(
    (radius, footprint) =>
      Math.max(
        radius,
        Math.hypot(footprint.centerX, footprint.centerZ) +
          getFootprintClearanceRadius(footprint, settings) +
          0.1,
      ),
    3.8,
  );
}

function getRequiredGroupRadius(settings: GroundRoutePlanSettings): number {
  if (settings.routeCount === 1) return 0;
  const minimumDistance = settings.moverRadius * 2 + settings.clearance;
  return minimumDistance / (2 * Math.sin(Math.PI / settings.routeCount)) + 0.1;
}

function getFootprintClearanceRadius(
  footprint: GroundFootprint,
  settings: GroundRoutePlanSettings,
): number {
  return footprint.radius + settings.moverRadius + settings.clearance;
}

function distance(first: RoutePoint, second: RoutePoint): number {
  return Math.hypot(second.x - first.x, second.z - first.z);
}
