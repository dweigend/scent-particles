/**
 * Adapts one static object-group definition to instanced tree rendering and scent emission.
 * Placement is deterministic setup work; the shared lib owns loading, footprints, and particles.
 */

import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import {
  createGroundFootprintFromTransform,
  type GroundFootprint,
} from "./lib/ground-footprints";
import { disposeLoadedModel, type LoadedModel } from "./lib/model-loader";
import type { StaticScentSource } from "./lib/scent-particle-system";
import {
  clampNumberSetting,
  type ModelSettings,
  type StaticBehaviorSettings,
  type StaticObjectGroupSettings,
} from "./lib/settings";

export class TreeGroup {
  readonly sceneObject = new Group();
  readonly modelSettings: ModelSettings;

  private readonly placementTransforms: readonly Matrix4[];
  private readonly groundFootprints: readonly GroundFootprint[];
  private readonly instancedMeshes: readonly InstancedMesh[];
  private count: number;

  constructor(
    private readonly loadedModel: LoadedModel,
    private readonly settings: StaticObjectGroupSettings,
  ) {
    this.modelSettings = loadedModel.settings;
    this.count = settings.count.initial;
    this.placementTransforms = createTransforms(settings.count.maximum, settings.behavior);
    this.groundFootprints = this.placementTransforms.map((transform) =>
      createGroundFootprintFromTransform(transform, loadedModel.groundFootprintRadius),
    );
    this.instancedMeshes = loadedModel.meshParts.map((meshPart) =>
      this.createInstancedMesh(meshPart),
    );
  }

  setCount(count: number): void {
    this.count = clampNumberSetting(count, this.settings.count);
    for (const instancedMesh of this.instancedMeshes) instancedMesh.count = this.count;
  }

  setVisible(visible: boolean): void {
    this.sceneObject.visible = visible;
  }

  getGroundFootprints(): readonly GroundFootprint[] {
    return this.groundFootprints.slice(0, this.count);
  }

  getScentSource(particlesPerObject: number): StaticScentSource {
    return {
      samplingSurface: this.loadedModel.samplingSurface,
      particlesPerObject,
      particleProperties: this.settings.scent.properties,
      transforms: this.placementTransforms.slice(0, this.count),
    };
  }

  dispose(): void {
    for (const instancedMesh of this.instancedMeshes) instancedMesh.dispose();
    disposeLoadedModel(this.loadedModel);
  }

  private createInstancedMesh(meshPart: LoadedModel["meshParts"][number]): InstancedMesh {
    const mesh = new InstancedMesh(
      meshPart.geometry,
      meshPart.material,
      this.settings.count.maximum,
    );
    const matrix = new Matrix4();
    for (let index = 0; index < this.settings.count.maximum; index += 1) {
      matrix.multiplyMatrices(this.placementTransforms[index]!, meshPart.matrix);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = this.count;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    this.sceneObject.add(mesh);
    return mesh;
  }
}

function createTransforms(
  count: number,
  behavior: StaticBehaviorSettings,
): readonly Matrix4[] {
  const random = createSeededRandom(behavior.seed);
  const positions = createPositions(count, behavior, random);
  return positions.map((position, index) => createTransform(position, index, random));
}

function createPositions(
  count: number,
  behavior: StaticBehaviorSettings,
  random: () => number,
): readonly Vector3[] {
  const positions = [new Vector3()];
  while (positions.length < count) {
    const candidate = createRandomPoint(behavior.placementRadius, random);
    if (positions.every((position) => position.distanceTo(candidate) >= behavior.minimumDistance)) {
      positions.push(candidate);
    }
  }
  return positions;
}

function createRandomPoint(radius: number, random: () => number): Vector3 {
  const angle = random() * Math.PI * 2;
  const distance = Math.sqrt(random()) * radius;
  return new Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
}

function createTransform(position: Vector3, index: number, random: () => number): Matrix4 {
  if (index === 0) return new Matrix4();
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI * 2);
  const scale = 0.82 + random() * 0.28;
  return new Matrix4().compose(position, rotation, new Vector3(scale, scale, scale));
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}
