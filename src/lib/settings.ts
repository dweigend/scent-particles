/**
 * Defines the shared configuration contracts and the demo's object-group catalogue.
 * Runtime state stays outside this module; UI and scene systems read the same immutable data.
 */

export type NumberRange = Readonly<{
  minimum: number;
  maximum: number;
}>;

export type NumberSetting = NumberRange &
  Readonly<{
    initial: number;
    step: number;
  }>;

export type ScentParticleProperties = Readonly<{
  attachmentSeconds: NumberRange;
  lifetimeSeconds: NumberRange;
  pointSize: NumberRange;
  color: NumberRange;
}>;

type ScentSettings = Readonly<{
  particlesPerObject: NumberSetting;
  properties: ScentParticleProperties;
}>;

export type ModelSettings = Readonly<{
  id: string;
  title: string;
  path: string;
  targetHeight: number;
  sourcePageUrl: string;
  attribution: string;
}>;

export type StaticBehaviorSettings = Readonly<{
  kind: "static";
  placementRadius: number;
  minimumDistance: number;
  seed: number;
}>;

export type GroundRouteBehaviorSettings = Readonly<{
  kind: "ground-route";
  animationClip: string;
  movementSpeed: number;
  animationSpeed: number;
  clearance: number;
}>;

type ObjectGroupSettingsBase = Readonly<{
  id: string;
  title: string;
  models: readonly ModelSettings[];
  count: NumberSetting;
  scent: ScentSettings;
}>;

export type StaticObjectGroupSettings = ObjectGroupSettingsBase &
  Readonly<{ behavior: StaticBehaviorSettings }>;

export type GroundRouteObjectGroupSettings = ObjectGroupSettingsBase &
  Readonly<{ behavior: GroundRouteBehaviorSettings }>;

export type ObjectGroupSettings =
  | StaticObjectGroupSettings
  | GroundRouteObjectGroupSettings;

export type WindSettings = Readonly<{
  windDirection: readonly [number, number, number];
  windSpeed: number;
}>;

export type ScentSystemSettings = WindSettings &
  Readonly<{
    maximumPixelRatio: number;
  }>;

export const SCENT_SYSTEM_SETTINGS: ScentSystemSettings = {
  windDirection: [0.82, 0.12, -0.46],
  windSpeed: 0.38,
  maximumPixelRatio: 1.5,
} as const;

const SHARED_PARTICLE_COUNT: NumberSetting = {
  minimum: 100,
  maximum: 5_000,
  initial: 1_000,
  step: 100,
};

export const TREE_GROUP_SETTINGS: StaticObjectGroupSettings = {
  id: "trees",
  title: "Bäume",
  models: [
    {
      id: "tree",
      title: "Tree",
      path: "/models/tree.glb",
      targetHeight: 3.2,
      sourcePageUrl: "https://poly.pizza/m/6pwiq7hSrHr",
      attribution: '"Tree" von Poly by Google · CC-BY 3.0',
    },
    {
      id: "pine-tree",
      title: "Pine Tree",
      path: "/models/pine-tree.glb",
      targetHeight: 3.2,
      sourcePageUrl: "https://poly.pizza/m/2Qo-fmVKuSG",
      attribution: '"Pine Tree" von Danni Bittman · CC-BY 3.0',
    },
    {
      id: "fall-tree",
      title: "Fall Tree",
      path: "/models/fall-tree.glb",
      targetHeight: 3.2,
      sourcePageUrl: "https://poly.pizza/m/4GYen9Xm3Kj",
      attribution: '"Fall Tree" von Danni Bittman · CC-BY 3.0',
    },
  ],
  count: { minimum: 1, maximum: 30, initial: 1, step: 1 },
  scent: {
    particlesPerObject: SHARED_PARTICLE_COUNT,
    properties: {
      attachmentSeconds: { minimum: 1, maximum: 1 },
      lifetimeSeconds: { minimum: 4, maximum: 8 },
      pointSize: { minimum: 10, maximum: 21 },
      color: { minimum: 0x14752e, maximum: 0x5cf073 },
    },
  },
  behavior: {
    kind: "static",
    placementRadius: 6.5,
    minimumDistance: 1.35,
    seed: 58_219,
  },
};

export const ANIMAL_GROUP_SETTINGS: GroundRouteObjectGroupSettings = {
  id: "animals",
  title: "Tiere",
  models: [
    {
      id: "deer",
      title: "Deer",
      path: "/models/deer.glb",
      targetHeight: 1.35,
      sourcePageUrl: "https://poly.pizza/m/T6Cs7tmMHJ",
      attribution: '"Deer" von Quaternius · CC0 1.0',
    },
  ],
  count: { minimum: 1, maximum: 10, initial: 2, step: 1 },
  scent: {
    particlesPerObject: SHARED_PARTICLE_COUNT,
    properties: {
      attachmentSeconds: { minimum: 0, maximum: 0 },
      lifetimeSeconds: { minimum: 4, maximum: 8 },
      pointSize: { minimum: 10, maximum: 21 },
      color: { minimum: 0x4a2d18, maximum: 0xb17a46 },
    },
  },
  behavior: {
    kind: "ground-route",
    animationClip: "Walk",
    movementSpeed: 1.65,
    animationSpeed: 1.45,
    clearance: 0.28,
  },
};

export const OBJECT_GROUP_SETTINGS = [
  TREE_GROUP_SETTINGS,
  ANIMAL_GROUP_SETTINGS,
] as const satisfies readonly ObjectGroupSettings[];

export function clampNumberSetting(value: number, setting: NumberSetting): number {
  return Math.min(setting.maximum, Math.max(setting.minimum, Math.floor(value)));
}

export function getMaximumParticleCount(
  groups: readonly ObjectGroupSettings[],
): number {
  return groups.reduce(
    (total, group) =>
      total + group.count.maximum * group.scent.particlesPerObject.maximum,
    0,
  );
}
