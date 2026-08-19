/**
 * Owns a dynamic pool of animated ground animals and their shared movement-route atlas.
 * Skinned meshes share geometry and materials, while each visible clone keeps its own skeleton.
 */

import { type AnimationClip, AnimationMixer, Group, type Object3D } from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { GroundFootprint } from "./lib/ground-footprints";
import { planGroundRoutes } from "./lib/ground-route-planner";
import { disposeLoadedModel, disposeSkeletons, type LoadedModel } from "./lib/model-loader";
import { MovementRouteAtlas } from "./lib/movement-route-atlas";
import type { RoutedScentSource } from "./lib/scent-particle-system";
import {
  clampNumberSetting,
  type GroundRouteObjectGroupSettings,
  type ModelSettings,
} from "./lib/settings";

type AnimalInstance = Readonly<{
  movementRoot: Group;
  animatedModel: Object3D;
  mixer: AnimationMixer;
}>;

type AnimalGroupOptions = Readonly<{
  loadedModel: LoadedModel;
  settings: GroundRouteObjectGroupSettings;
  footprints: readonly GroundFootprint[];
  initialCount?: number;
}>;

export class AnimalGroup {
  readonly sceneObject = new Group();
  readonly modelSettings: ModelSettings;

  private readonly animalInstances: AnimalInstance[] = [];
  private readonly loadedModel: LoadedModel;
  private readonly settings: GroundRouteObjectGroupSettings;
  private readonly walkClip: AnimationClip;
  private activeCount: number;
  private routeAtlas: MovementRouteAtlas;

  constructor(options: AnimalGroupOptions) {
    this.loadedModel = options.loadedModel;
    this.settings = options.settings;
    const walkClip = options.loadedModel.animations.find(
      ({ name }) => name === options.settings.behavior.animationClip,
    );
    if (!walkClip) throw new Error("Required animation clip missing.");
    this.walkClip = walkClip;
    this.modelSettings = options.loadedModel.settings;
    this.activeCount = clampNumberSetting(
      options.initialCount ?? options.settings.count.initial,
      options.settings.count,
    );
    this.routeAtlas = this.createRouteAtlas(options.footprints, this.activeCount);
    this.ensureInstanceCount(this.activeCount);
    this.updateVisibility();
    this.update(0, 0);
  }

  setCount(count: number, footprints: readonly GroundFootprint[]): void {
    const nextCount = clampNumberSetting(count, this.settings.count);
    const nextRouteAtlas = this.createRouteAtlas(footprints, nextCount);
    this.ensureInstanceCount(nextCount);

    const previousRouteAtlas = this.routeAtlas;
    this.activeCount = nextCount;
    this.routeAtlas = nextRouteAtlas;
    this.updateVisibility();
    previousRouteAtlas.dispose();
  }

  setVisible(visible: boolean): void {
    this.sceneObject.visible = visible;
  }

  getRouteAtlas(): MovementRouteAtlas {
    return this.routeAtlas;
  }

  getScentSource(particlesPerObject: number): RoutedScentSource {
    return {
      samplingSurface: this.loadedModel.samplingSurface,
      particlesPerObject,
      particleProperties: this.settings.scent.properties,
      routeHandles: this.routeAtlas.routeHandles,
    };
  }

  update(elapsedSeconds: number, deltaSeconds: number): void {
    for (let index = 0; index < this.activeCount; index += 1) {
      const animalInstance = this.animalInstances[index]!;
      this.routeAtlas.writeMatrixAtTime(
        this.routeAtlas.routeHandles[index]!,
        elapsedSeconds,
        animalInstance.movementRoot.matrix,
      );
      animalInstance.mixer.update(deltaSeconds);
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
      clearance: this.settings.behavior.clearance,
    });
    return new MovementRouteAtlas(routes, this.settings.behavior.movementSpeed);
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
    mixer.timeScale = this.settings.behavior.animationSpeed;
    mixer.setTime(this.walkClip.duration * ((index * 0.37) % 1));
    return { movementRoot, animatedModel, mixer };
  }

  private updateVisibility(): void {
    for (let index = 0; index < this.animalInstances.length; index += 1) {
      this.animalInstances[index]!.movementRoot.visible = index < this.activeCount;
    }
  }
}
