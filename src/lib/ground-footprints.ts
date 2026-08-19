/**
 * Defines the reusable circular footprint used by procedural ground movement.
 * It represents upright objects on the XZ plane; rendering and vertical geometry stay outside.
 */

import type { Matrix4 } from "three";

export type GroundFootprint = Readonly<{
  centerX: number;
  centerZ: number;
  radius: number;
}>;

export function createGroundFootprintFromTransform(
  transform: Matrix4,
  localRadius: number,
): GroundFootprint {
  const elements = transform.elements;
  const scaleX = Math.hypot(elements[0]!, elements[1]!, elements[2]!);
  const scaleZ = Math.hypot(elements[8]!, elements[9]!, elements[10]!);
  return {
    centerX: elements[12]!,
    centerZ: elements[14]!,
    radius: localRadius * Math.max(scaleX, scaleZ),
  };
}
