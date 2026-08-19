/**
 * Owns a dynamic pool of animated ground animals and their shared movement-route atlas.
 * Skinned meshes share geometry and materials, while each visible clone keeps its own skeleton.
 */

import { type AnimationClip, AnimationMixer, Group, type Object3D } from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { GroundFootprint } from "./ground-footprints";
import { planGroundRoutes } from "./ground-route-planner";
import { disposeLoadedModel, disposeSkeletons, type LoadedModel } from "./model-loader";
import { MovementRouteAtlas } from "./movement-route-atlas";
import type { ScentParticleSettings, ScentSource } from "./scent-particles";

export const MIN_ANIMAL_COUNT = 1;
export const MAX_ANIMAL_COUNT = 10;
export const DEFAULT_ANIMAL_COUNT = 2;

const MOVEMENT_SPEED = 1.65;
const WALK_ANIMATION_SPEED = 1.45;
const GROUND_CLEARANCE = 0.28;
const ANIMAL_PARTICLE_SETTINGS: ScentParticleSettings = {
  attachmentSeconds: { minimum: 0, maximum: 0 },
  lifetimeSeconds: { minimum: 4, maximum: 8 },
  pointSize: { minimum: 10, maximum: 21 },
  color: { minimum: 0x4a2d18, maximum: 0xb17a46 },
};

type AnimalInstance = Readonly<{
  movementRoot: Group;
  animatedModel: Object3D;
  mixer: AnimationMixer;
}>;

export class AnimalGroup {
  readonly sceneObject = new Group();
  readonly asset: LoadedModel["asset"];

  private readonly animalInstances: AnimalInstance[] = [];
  private readonly walkClip: AnimationClip;
  private activeCount: number;
  private routeAtlas: MovementRouteAtlas;

  constructor(
    private readonly loadedModel: LoadedModel,
    footprints: readonly GroundFootprint[],
    initialCount = DEFAULT_ANIMAL_COUNT,
  ) {
    const walkClip = loadedModel.animations.find(({ name }) => name === "Walk");
    if (!walkClip) throw new Error("Laufanimation fehlt.");
    this.walkClip = walkClip;
    this.asset = loadedModel.asset;
    this.activeCount = clampAnimalCount(initialCount);
    this.routeAtlas = this.createRouteAtlas(footprints, this.activeCount);
    this.ensureInstanceCount(this.activeCount);
    this.updateVisibility();
    this.update(0, 0);
  }

  setCount(count: number, footprints: readonly GroundFootprint[]): void {
    const nextCount = clampAnimalCount(count);
    const nextRouteAtlas = this.createRouteAtlas(footprints, nextCount);
    this.ensureInstanceCount(nextCount);

    const previousRouteAtlas = this.routeAtlas;
    this.activeCount = nextCount;
    this.routeAtlas = nextRouteAtlas;
    this.updateVisibility();
    previousRouteAtlas.dispose();
  }

  getCount(): number {
    return this.activeCount;
  }

  getRouteAtlas(): MovementRouteAtlas {
    return this.routeAtlas;
  }

  getScentSource(): ScentSource {
    return {
      samplingSurface: this.loadedModel.samplingSurface,
      particleSettings: ANIMAL_PARTICLE_SETTINGS,
      emitters: this.routeAtlas.routeHandles.map((routeHandle) => ({
        kind: "route",
        routeHandle,
      })),
    };
  }

  update(elapsedTime: number, deltaTime: number): void {
    for (let index = 0; index < this.activeCount; index += 1) {
      const animalInstance = this.animalInstances[index]!;
      this.routeAtlas.writeMatrixAtTime(
        this.routeAtlas.routeHandles[index]!,
        elapsedTime,
        animalInstance.movementRoot.matrix,
      );
      animalInstance.mixer.update(deltaTime);
    }
  }

  dispose(): void {
    for (const { mixer, animatedModel } of this.animalInstances) {
      mixer.stopAllAction();
      mixer.uncacheRoot(animatedModel);
      disposeSkeletons(animatedModel);
    }
    this.routeAtlas.dispose();
    disposeLoadedModel(this.loadedModel);
  }

  private createRouteAtlas(
    footprints: readonly GroundFootprint[],
    routeCount: number,
  ): MovementRouteAtlas {
    const routes = planGroundRoutes(footprints, {
      routeCount,
      moverRadius: this.loadedModel.groundFootprintRadius,
      clearance: GROUND_CLEARANCE,
    });
    return new MovementRouteAtlas(routes, MOVEMENT_SPEED);
  }

  private ensureInstanceCount(count: number): void {
    while (this.animalInstances.length < count) {
      this.animalInstances.push(this.createAnimalInstance(this.animalInstances.length));
    }
  }

  private createAnimalInstance(index: number): AnimalInstance {
    const movementRoot = new Group();
    const animatedModel = clone(this.loadedModel.root);
    const mixer = new AnimationMixer(animatedModel);
    movementRoot.matrixAutoUpdate = false;
    movementRoot.add(animatedModel);
    this.sceneObject.add(movementRoot);

    mixer.clipAction(this.walkClip).play();
    mixer.timeScale = WALK_ANIMATION_SPEED;
    mixer.setTime(this.walkClip.duration * ((index * 0.37) % 1));
    return { movementRoot, animatedModel, mixer };
  }

  private updateVisibility(): void {
    for (let index = 0; index < this.animalInstances.length; index += 1) {
      this.animalInstances[index]!.movementRoot.visible = index < this.activeCount;
    }
  }
}

function clampAnimalCount(count: number): number {
  return Math.min(MAX_ANIMAL_COUNT, Math.max(MIN_ANIMAL_COUNT, Math.floor(count)));
}
