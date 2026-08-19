/**
 * Owns one preallocated GPU particle buffer for static and route-driven scent sources.
 * Sampling is explicit CPU setup work; lifecycle, attachment, and wind run in one drawcall.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  Matrix3,
  Matrix4,
  Mesh,
  NearestFilter,
  NormalBlending,
  Points,
  RGBAFormat,
  ShaderMaterial,
  Uint8BufferAttribute,
  Vector3,
} from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import fragmentShader from "./scent-particle.frag.glsl?raw";
import vertexShader from "./scent-particle.vert.glsl?raw";
import type { MovementRouteAtlas, MovementRouteHandle } from "./movement-route-atlas";
import type { NumberRange, ScentParticleProperties, WindSettings } from "./settings";

const SURFACE_OFFSET = 0.012;
const surfaceSamplers = new WeakMap<BufferGeometry, MeshSurfaceSampler>();

type ScentSourceBase = Readonly<{
  samplingSurface: BufferGeometry;
  particlesPerObject: number;
  particleProperties: ScentParticleProperties;
}>;

/** A rigid source whose transforms are sampled directly into world space. */
export type StaticScentSource = ScentSourceBase &
  Readonly<{ transforms: readonly Matrix4[] }>;

/** A moving source whose local samples follow handles from one shared route atlas. */
export type RoutedScentSource = ScentSourceBase &
  Readonly<{ routeHandles: readonly MovementRouteHandle[] }>;

export type RoutedScentSources = Readonly<{
  routeAtlas: MovementRouteAtlas;
  sources: readonly RoutedScentSource[];
}>;

/**
 * Complete sampling input. Grouping routed sources with their atlas prevents missing route data.
 * All routed sources deliberately share one atlas so the particle system remains one drawcall.
 */
export type ScentSourceSet = Readonly<{
  staticSources: readonly StaticScentSource[];
  routedSources?: RoutedScentSources;
}>;

export type ScentParticleSystemOptions = Readonly<{
  particleCapacity: number;
  pixelRatio: number;
  wind: WindSettings;
}>;

export class ScentParticleSystem {
  readonly sceneObject: Points<BufferGeometry, ShaderMaterial>;

  private readonly fallbackRouteTexture = createFallbackRouteTexture();
  private readonly particleCapacity: number;
  private renderedCount = 0;

  constructor(options: ScentParticleSystemOptions) {
    if (options.particleCapacity < 1) throw new Error("Particle capacity must be positive.");
    this.particleCapacity = Math.floor(options.particleCapacity);
    const geometry = createParticleGeometry(this.particleCapacity);
    this.sceneObject = new Points(
      geometry,
      createParticleMaterial(options.pixelRatio, options.wind, this.fallbackRouteTexture),
    );
    this.sceneObject.frustumCulled = false;
    this.sceneObject.renderOrder = 10;
    geometry.setDrawRange(0, 0);
  }

  resample(sourceSet: ScentSourceSet): void {
    const requestedCount = getRequestedParticleCount(sourceSet);
    if (requestedCount > this.particleCapacity) {
      throw new Error("Particle capacity exceeded.");
    }

    this.setRouteAtlas(sourceSet.routedSources?.routeAtlas);
    this.renderedCount = sampleSourceSet(
      getParticleAttributes(this.sceneObject.geometry),
      sourceSet,
    );
    this.sceneObject.geometry.setDrawRange(0, this.renderedCount);
  }

  getRenderedParticleCount(): number {
    return this.renderedCount;
  }

  setTime(elapsedSeconds: number): void {
    this.sceneObject.material.uniforms.uTime!.value = elapsedSeconds;
  }

  setPixelRatio(pixelRatio: number): void {
    this.sceneObject.material.uniforms.uPixelRatio!.value = pixelRatio;
  }

  dispose(): void {
    this.sceneObject.geometry.dispose();
    this.sceneObject.material.dispose();
    this.fallbackRouteTexture.dispose();
  }

  private setRouteAtlas(routeAtlas: MovementRouteAtlas | undefined): void {
    const uniforms = this.sceneObject.material.uniforms;
    uniforms.uRouteTexture!.value = routeAtlas?.texture ?? this.fallbackRouteTexture;
    uniforms.uRouteSampleCount!.value = routeAtlas?.sampleCount ?? 1;
    uniforms.uRouteCount!.value = routeAtlas?.routeCount ?? 1;
  }
}

type ParticleAttributes = Readonly<{
  attachmentSeconds: BufferAttribute;
  color: BufferAttribute;
  position: BufferAttribute;
  lifetime: BufferAttribute;
  phase: BufferAttribute;
  size: BufferAttribute;
  routeHandle: BufferAttribute;
}>;

type ScentEmitter =
  | Readonly<{ kind: "static"; transform: Matrix4 }>
  | Readonly<{ kind: "route"; routeHandle: MovementRouteHandle }>;

type SourceSamplingSettings = Readonly<{
  source: ScentSourceBase;
  emitters: readonly ScentEmitter[];
  attributes: ParticleAttributes;
  startIndex: number;
}>;

type EmitterSamplingSettings = Readonly<{
  sampler: MeshSurfaceSampler;
  emitter: ScentEmitter;
  attributes: ParticleAttributes;
  startIndex: number;
  particleCount: number;
  propertySampler: ParticlePropertySampler;
}>;

type ParticlePropertySampler = Readonly<{
  properties: ScentParticleProperties;
  minimumColor: Color;
  maximumColor: Color;
  sampledColor: Color;
}>;

type SurfaceTransform = Readonly<{
  emitter: ScentEmitter;
  normalMatrix: Matrix3 | undefined;
}>;

function createParticleGeometry(particleCapacity: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(particleCapacity * 3), 3));
  geometry.setAttribute(
    "aAttachmentSeconds",
    new BufferAttribute(new Float32Array(particleCapacity), 1),
  );
  geometry.setAttribute(
    "aColor",
    new Uint8BufferAttribute(new Uint8Array(particleCapacity * 3), 3, true),
  );
  geometry.setAttribute("aLifetime", new BufferAttribute(new Float32Array(particleCapacity), 1));
  geometry.setAttribute("aPhase", new BufferAttribute(new Float32Array(particleCapacity), 1));
  geometry.setAttribute("aSize", new BufferAttribute(new Float32Array(particleCapacity), 1));
  geometry.setAttribute(
    "aRouteHandle",
    new BufferAttribute(new Float32Array(particleCapacity * 2), 2),
  );
  return geometry;
}

function getParticleAttributes(geometry: BufferGeometry): ParticleAttributes {
  return {
    attachmentSeconds: geometry.getAttribute("aAttachmentSeconds") as BufferAttribute,
    color: geometry.getAttribute("aColor") as BufferAttribute,
    position: geometry.getAttribute("position") as BufferAttribute,
    lifetime: geometry.getAttribute("aLifetime") as BufferAttribute,
    phase: geometry.getAttribute("aPhase") as BufferAttribute,
    size: geometry.getAttribute("aSize") as BufferAttribute,
    routeHandle: geometry.getAttribute("aRouteHandle") as BufferAttribute,
  };
}

function getRequestedParticleCount(sourceSet: ScentSourceSet): number {
  const staticCount = sourceSet.staticSources.reduce(
    (total, source) => total + source.transforms.length * getParticleCount(source),
    0,
  );
  const routedCount = sourceSet.routedSources?.sources.reduce(
    (total, source) => total + source.routeHandles.length * getParticleCount(source),
    0,
  );
  return staticCount + (routedCount ?? 0);
}

function sampleSourceSet(
  attributes: ParticleAttributes,
  sourceSet: ScentSourceSet,
): number {
  const staticCount = sampleStaticSources(attributes, sourceSet.staticSources);
  const renderedCount = sampleRoutedSources(
    attributes,
    sourceSet.routedSources?.sources ?? [],
    staticCount,
  );
  markAttributesForUpdate(attributes);
  return renderedCount;
}

function sampleStaticSources(
  attributes: ParticleAttributes,
  sources: readonly StaticScentSource[],
): number {
  let particleIndex = 0;
  for (const source of sources) {
    particleIndex = sampleSource({
      source,
      emitters: source.transforms.map((transform) => ({ kind: "static", transform })),
      attributes,
      startIndex: particleIndex,
    });
  }
  return particleIndex;
}

function sampleRoutedSources(
  attributes: ParticleAttributes,
  sources: readonly RoutedScentSource[],
  startIndex: number,
): number {
  let particleIndex = startIndex;
  for (const source of sources) {
    particleIndex = sampleSource({
      source,
      emitters: source.routeHandles.map((routeHandle) => ({ kind: "route", routeHandle })),
      attributes,
      startIndex: particleIndex,
    });
  }
  return particleIndex;
}

function sampleSource(settings: SourceSamplingSettings): number {
  let particleIndex = settings.startIndex;
  const sampler = getSurfaceSampler(settings.source.samplingSurface);
  const propertySampler = createParticlePropertySampler(settings.source.particleProperties);
  for (const emitter of settings.emitters) {
    particleIndex = sampleEmitter({
      sampler,
      emitter,
      attributes: settings.attributes,
      startIndex: particleIndex,
      particleCount: getParticleCount(settings.source),
      propertySampler,
    });
  }
  return particleIndex;
}

function sampleEmitter(settings: EmitterSamplingSettings): number {
  const { sampler, emitter, attributes, startIndex, particleCount, propertySampler } = settings;
  const point = new Vector3();
  const normal = new Vector3();
  const normalMatrix =
    emitter.kind === "static" ? new Matrix3().getNormalMatrix(emitter.transform) : undefined;
  for (let localIndex = 0; localIndex < particleCount; localIndex += 1) {
    sampler.sample(point, normal);
    transformSurfacePoint(point, normal, { emitter, normalMatrix });
    const particleIndex = startIndex + localIndex;
    attributes.position.setXYZ(particleIndex, point.x, point.y, point.z);
    writeRouteHandle(attributes, particleIndex, emitter);
    writeParticleProperties(attributes, particleIndex, propertySampler);
  }
  return startIndex + particleCount;
}

function getSurfaceSampler(geometry: BufferGeometry): MeshSurfaceSampler {
  const cachedSampler = surfaceSamplers.get(geometry);
  if (cachedSampler) return cachedSampler;
  const sampler = new MeshSurfaceSampler(new Mesh(geometry)).build();
  surfaceSamplers.set(geometry, sampler);
  return sampler;
}

function getParticleCount(source: ScentSourceBase): number {
  return Math.max(0, Math.floor(source.particlesPerObject));
}

function transformSurfacePoint(
  point: Vector3,
  normal: Vector3,
  transform: SurfaceTransform,
): void {
  const { emitter, normalMatrix } = transform;
  if (emitter.kind === "static" && normalMatrix) {
    point.applyMatrix4(emitter.transform);
    normal.applyMatrix3(normalMatrix).normalize();
  }
  point.addScaledVector(normal, SURFACE_OFFSET);
}

function writeRouteHandle(
  attributes: ParticleAttributes,
  index: number,
  emitter: ScentEmitter,
): void {
  if (emitter.kind === "static") {
    attributes.routeHandle.setXY(index, -1, 1);
    return;
  }
  attributes.routeHandle.setXY(
    index,
    emitter.routeHandle.index,
    emitter.routeHandle.durationSeconds,
  );
}

function writeParticleProperties(
  attributes: ParticleAttributes,
  index: number,
  sampler: ParticlePropertySampler,
): void {
  const lifetime = sampleNumberRange(sampler.properties.lifetimeSeconds);
  const color = sampler.sampledColor
    .copy(sampler.minimumColor)
    .lerp(sampler.maximumColor, Math.random());
  attributes.attachmentSeconds.setX(
    index,
    sampleNumberRange(sampler.properties.attachmentSeconds),
  );
  attributes.color.setXYZ(index, color.r, color.g, color.b);
  attributes.lifetime.setX(index, lifetime);
  attributes.phase.setX(index, Math.random() * lifetime);
  attributes.size.setX(index, sampleNumberRange(sampler.properties.pointSize));
}

function createParticlePropertySampler(
  properties: ScentParticleProperties,
): ParticlePropertySampler {
  return {
    properties,
    minimumColor: new Color(properties.color.minimum),
    maximumColor: new Color(properties.color.maximum),
    sampledColor: new Color(),
  };
}

function sampleNumberRange(range: NumberRange): number {
  return range.minimum + Math.random() * (range.maximum - range.minimum);
}

function markAttributesForUpdate(attributes: ParticleAttributes): void {
  attributes.attachmentSeconds.needsUpdate = true;
  attributes.color.needsUpdate = true;
  attributes.position.needsUpdate = true;
  attributes.lifetime.needsUpdate = true;
  attributes.phase.needsUpdate = true;
  attributes.size.needsUpdate = true;
  attributes.routeHandle.needsUpdate = true;
}

function createParticleMaterial(
  pixelRatio: number,
  wind: WindSettings,
  fallbackRouteTexture: DataTexture,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uWindDirection: { value: new Vector3(...wind.windDirection) },
      uWindSpeed: { value: wind.windSpeed },
      uRouteTexture: { value: fallbackRouteTexture },
      uRouteSampleCount: { value: 1 },
      uRouteCount: { value: 1 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: NormalBlending,
  });
}

function createFallbackRouteTexture(): DataTexture {
  const texture = new DataTexture(
    new Float32Array([0, 0, 0, 1]),
    1,
    1,
    RGBAFormat,
    FloatType,
  );
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
