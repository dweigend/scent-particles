/**
 * Loads a GLB once and exposes normalized mesh parts plus one sampling surface.
 * Instancing and object movement stay in their owning scene modules.
 */

import {
  AnimationClip,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ModelSettings } from "./settings";

const loader = new GLTFLoader();

export type ModelMeshPart = Readonly<{
  geometry: BufferGeometry;
  material: Material | Material[];
  matrix: Matrix4;
}>;

export type LoadedModel = Readonly<{
  settings: ModelSettings;
  root: Object3D;
  animations: readonly AnimationClip[];
  meshParts: readonly ModelMeshPart[];
  samplingSurface: BufferGeometry;
  groundFootprintRadius: number;
}>;

export async function loadModel(settings: ModelSettings): Promise<LoadedModel> {
  const { scene, animations } = await loader.loadAsync(settings.path);
  normalizeModel(scene, settings.targetHeight);
  const meshParts = collectMeshParts(scene);
  if (meshParts.length === 0) throw new Error("Invalid 3D asset.");
  const samplingSurface = createSamplingSurface(meshParts);
  return {
    settings,
    root: scene,
    animations,
    meshParts,
    samplingSurface,
    groundFootprintRadius: getGroundFootprintRadius(samplingSurface),
  };
}

export function disposeLoadedModel(loadedModel: LoadedModel): void {
  const geometries = new Set(loadedModel.meshParts.map(({ geometry }) => geometry));
  const materials = new Set(
    loadedModel.meshParts.flatMap(({ material }) => asArray(material)),
  );
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  disposeSkeletons(loadedModel.root);
  loadedModel.samplingSurface.dispose();
}

export function disposeSkeletons(root: Object3D): void {
  const skeletons = new Set<Skeleton>();
  root.traverse((object) => {
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
}

function normalizeModel(root: Object3D, targetHeight: number): void {
  const initialBounds = new Box3().setFromObject(root);
  const height = initialBounds.getSize(new Vector3()).y;
  if (height <= 0) throw new Error("Invalid 3D asset.");

  root.scale.setScalar(targetHeight / height);
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  root.updateMatrixWorld(true);
}

function collectMeshParts(root: Object3D): readonly ModelMeshPart[] {
  const meshParts: ModelMeshPart[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    meshParts.push({
      geometry: object.geometry,
      material: object.material,
      matrix: object.matrixWorld.clone(),
    });
  });
  return meshParts;
}

function createSamplingSurface(meshParts: readonly ModelMeshPart[]): BufferGeometry {
  const chunks = meshParts.map(({ geometry, matrix }) =>
    readWorldSpaceTrianglePositions(geometry, matrix),
  );
  const samplingSurface = new BufferGeometry();
  samplingSurface.setAttribute(
    "position",
    new BufferAttribute(concatFloat32Arrays(chunks), 3),
  );
  samplingSurface.computeVertexNormals();
  return samplingSurface;
}

function readWorldSpaceTrianglePositions(
  geometry: BufferGeometry,
  matrix: Matrix4,
): Float32Array {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  copy.applyMatrix4(matrix);
  const positions = copy.getAttribute("position");
  const result = new Float32Array(positions.count * 3);
  for (let index = 0; index < positions.count; index += 1) {
    result[index * 3] = positions.getX(index);
    result[index * 3 + 1] = positions.getY(index);
    result[index * 3 + 2] = positions.getZ(index);
  }
  copy.dispose();
  return result;
}

function concatFloat32Arrays(chunks: readonly Float32Array[]): Float32Array {
  const result = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function getGroundFootprintRadius(samplingSurface: BufferGeometry): number {
  const positions = samplingSurface.getAttribute("position");
  let radius = 0;
  for (let index = 0; index < positions.count; index += 1) {
    radius = Math.max(radius, Math.hypot(positions.getX(index), positions.getZ(index)));
  }
  return radius;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
