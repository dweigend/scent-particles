/**
 * Renders a deterministic static forest with one InstancedMesh per source mesh part.
 * Placement matrices are generated once; runtime controls only change instance counts.
 */

import { Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { disposeModel, type LoadedModel } from "./models";

export const MAX_TREE_COUNT = 30;

const FOREST_SEED = 58_219;
const FOREST_RADIUS = 6.5;
const MIN_TREE_DISTANCE = 1.35;

export class Forest {
  readonly object = new Group();
  readonly asset;
  readonly surface;

  private readonly placements = createPlacements(MAX_TREE_COUNT, FOREST_SEED);
  private readonly meshes: readonly InstancedMesh[];
  private treeCount = 1;

  constructor(private readonly model: LoadedModel) {
    this.asset = model.asset;
    this.surface = model.surface;
    this.meshes = model.parts.map((part) => this.createInstances(part));
  }

  setCount(count: number): void {
    this.treeCount = Math.min(MAX_TREE_COUNT, Math.max(1, Math.floor(count)));
    for (const mesh of this.meshes) mesh.count = this.treeCount;
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible;
  }

  getActivePlacements(): readonly Matrix4[] {
    return this.placements.slice(0, this.treeCount);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    disposeModel(this.model);
  }

  private createInstances(part: LoadedModel["parts"][number]): InstancedMesh {
    const mesh = new InstancedMesh(part.geometry, part.material, MAX_TREE_COUNT);
    const matrix = new Matrix4();
    for (let index = 0; index < MAX_TREE_COUNT; index += 1) {
      matrix.multiplyMatrices(this.placements[index]!, part.matrix);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = this.treeCount;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    this.object.add(mesh);
    return mesh;
  }
}

function createPlacements(count: number, seed: number): readonly Matrix4[] {
  const random = createRandom(seed);
  const positions = createPositions(count, random);
  return positions.map((position, index) => createTransform(position, index, random));
}

function createPositions(count: number, random: () => number): readonly Vector3[] {
  const positions = [new Vector3()];
  while (positions.length < count) {
    const candidate = randomPoint(random);
    if (positions.every((position) => position.distanceTo(candidate) >= MIN_TREE_DISTANCE)) {
      positions.push(candidate);
    }
  }
  return positions;
}

function randomPoint(random: () => number): Vector3 {
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

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}
