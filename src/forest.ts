/**
 * Renders a deterministic static forest with one InstancedMesh per source mesh part.
 * Placement matrices are generated once; runtime controls only change instance counts.
 */

import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import {
  createGroundFootprintFromTransform,
  type GroundFootprint,
} from "./ground-footprints";
import { disposeLoadedModel, type LoadedModel } from "./model-loader";
import type { ScentParticleSettings, ScentSource } from "./scent-particles";

export const MIN_TREE_COUNT = 1;
export const MAX_TREE_COUNT = 30;
export const DEFAULT_TREE_COUNT = 1;

const FOREST_SEED = 58_219;
const FOREST_RADIUS = 6.5;
const MIN_TREE_DISTANCE = 1.35;
const TREE_PARTICLE_SETTINGS: ScentParticleSettings = {
  attachmentSeconds: { minimum: 1, maximum: 1 },
  lifetimeSeconds: { minimum: 4, maximum: 8 },
  pointSize: { minimum: 10, maximum: 21 },
  color: { minimum: 0x14752e, maximum: 0x5cf073 },
};

export class Forest {
  readonly sceneObject = new Group();
  readonly asset: LoadedModel["asset"];

  private readonly placementTransforms = createTreeTransforms(MAX_TREE_COUNT, FOREST_SEED);
  private readonly groundFootprints: readonly GroundFootprint[];
  private readonly instancedMeshes: readonly InstancedMesh[];
  private treeCount = DEFAULT_TREE_COUNT;

  constructor(private readonly loadedModel: LoadedModel) {
    this.asset = loadedModel.asset;
    this.groundFootprints = this.placementTransforms.map((placementTransform) =>
      createGroundFootprintFromTransform(
        placementTransform,
        loadedModel.groundFootprintRadius,
      ),
    );
    this.instancedMeshes = loadedModel.meshParts.map((meshPart) =>
      this.createInstancedMesh(meshPart),
    );
  }

  setCount(count: number): void {
    this.treeCount = Math.min(MAX_TREE_COUNT, Math.max(MIN_TREE_COUNT, Math.floor(count)));
    for (const instancedMesh of this.instancedMeshes) instancedMesh.count = this.treeCount;
  }

  setVisible(visible: boolean): void {
    this.sceneObject.visible = visible;
  }

  getCount(): number {
    return this.treeCount;
  }

  getGroundFootprints(): readonly GroundFootprint[] {
    return this.groundFootprints.slice(0, this.treeCount);
  }

  getScentSource(): ScentSource {
    return {
      samplingSurface: this.loadedModel.samplingSurface,
      particleSettings: TREE_PARTICLE_SETTINGS,
      emitters: this.placementTransforms.slice(0, this.treeCount).map((transform) => ({
        kind: "static",
        transform,
      })),
    };
  }

  dispose(): void {
    for (const instancedMesh of this.instancedMeshes) instancedMesh.dispose();
    disposeLoadedModel(this.loadedModel);
  }

  private createInstancedMesh(meshPart: LoadedModel["meshParts"][number]): InstancedMesh {
    const mesh = new InstancedMesh(meshPart.geometry, meshPart.material, MAX_TREE_COUNT);
    const matrix = new Matrix4();
    for (let index = 0; index < MAX_TREE_COUNT; index += 1) {
      matrix.multiplyMatrices(this.placementTransforms[index]!, meshPart.matrix);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = this.treeCount;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    this.sceneObject.add(mesh);
    return mesh;
  }
}

function createTreeTransforms(count: number, seed: number): readonly Matrix4[] {
  const random = createSeededRandom(seed);
  const positions = createTreePositions(count, random);
  return positions.map((position, index) => createTransform(position, index, random));
}

function createTreePositions(count: number, random: () => number): readonly Vector3[] {
  const positions = [new Vector3()];
  while (positions.length < count) {
    const candidate = createRandomForestPoint(random);
    if (positions.every((position) => position.distanceTo(candidate) >= MIN_TREE_DISTANCE)) {
      positions.push(candidate);
    }
  }
  return positions;
}

function createRandomForestPoint(random: () => number): Vector3 {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * FOREST_RADIUS;
  return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
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
