/**
 * Loads a static GLB once and exposes normalized mesh parts plus one sampling surface.
 * Rendering multiplicity belongs to the forest module; animation and skinning stay out of scope.
 */

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ModelAsset } from "./assets";

const TARGET_HEIGHT = 3.2;
const loader = new GLTFLoader();

export type ModelPart = Readonly<{
  geometry: BufferGeometry;
  material: Material | Material[];
  matrix: Matrix4;
}>;

export type LoadedModel = Readonly<{
  asset: ModelAsset;
  parts: readonly ModelPart[];
  surface: BufferGeometry;
}>;

export async function loadModel(asset: ModelAsset): Promise<LoadedModel> {
  const { scene } = await loader.loadAsync(asset.path);
  normalizeModel(scene);
  const parts = collectParts(scene);
  if (parts.length === 0) throw new Error("Das Modell enthält keine Mesh-Oberfläche.");
  return { asset, parts, surface: createSamplingSurface(parts) };
}

export function disposeModel(model: LoadedModel): void {
  const geometries = new Set(model.parts.map(({ geometry }) => geometry));
  const materials = new Set(model.parts.flatMap(({ material }) => asArray(material)));
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  model.surface.dispose();
}

function normalizeModel(root: Object3D): void {
  const initialBounds = new Box3().setFromObject(root);
  const height = initialBounds.getSize(new Vector3()).y;
  if (height <= 0) throw new Error("Das Modell besitzt keine nutzbare Höhe.");

  root.scale.setScalar(TARGET_HEIGHT / height);
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  const center = bounds.getCenter(new Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  root.updateMatrixWorld(true);
}

function collectParts(root: Object3D): readonly ModelPart[] {
  const parts: ModelPart[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    parts.push({
      geometry: object.geometry,
      material: object.material,
      matrix: object.matrixWorld.clone(),
    });
  });
  return parts;
}

function createSamplingSurface(parts: readonly ModelPart[]): BufferGeometry {
  const chunks = parts.map(({ geometry, matrix }) => readWorldSpaceTriangles(geometry, matrix));
  const surface = new BufferGeometry();
  surface.setAttribute("position", new BufferAttribute(join(chunks), 3));
  surface.computeVertexNormals();
  return surface;
}

function readWorldSpaceTriangles(geometry: BufferGeometry, matrix: Matrix4): Float32Array {
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

function join(chunks: readonly Float32Array[]): Float32Array {
  const result = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
