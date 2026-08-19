/**
 * Implements one continuous scent drawcall for static and route-driven mesh emitters.
 * CPU work is limited to explicit sampling; attachment, release, and wind run on the GPU.
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
import type { MovementRouteAtlas, MovementRouteHandle } from "./movement-route-atlas";

export const MIN_PARTICLES_PER_EMITTER = 100;
export const MAX_PARTICLES_PER_EMITTER = 5_000;
export const DEFAULT_PARTICLES_PER_EMITTER = 1_000;

const SURFACE_OFFSET = 0.012;

const vertexShader = /* glsl */ `
  attribute float aAttachmentSeconds;
  attribute vec3 aColor;
  attribute float aLifetime;
  attribute float aPhase;
  attribute float aSize;
  attribute vec2 aRouteHandle;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform sampler2D uRouteTexture;
  uniform float uRouteSampleCount;
  uniform float uRouteCount;

  varying vec3 vColor;
  varying float vOpacity;

  const float WIND_SPEED = 0.38;

  float smoothRange(float start, float end, float value) {
    float t = clamp((value - start) / (end - start), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  vec3 rotateY(vec3 point, vec2 heading) {
    return vec3(
      heading.y * point.x + heading.x * point.z,
      point.y,
      -heading.x * point.x + heading.y * point.z
    );
  }

  vec4 routeSampleAt(float routeIndex, float time, float duration) {
    float samplePosition = fract(time / duration) * uRouteSampleCount;
    float firstIndex = floor(samplePosition);
    float secondIndex = mod(firstIndex + 1.0, uRouteSampleCount);
    float blend = fract(samplePosition);
    float routeY = (routeIndex + 0.5) / uRouteCount;
    vec4 first = texture2D(
      uRouteTexture,
      vec2((firstIndex + 0.5) / uRouteSampleCount, routeY)
    );
    vec4 second = texture2D(
      uRouteTexture,
      vec2((secondIndex + 0.5) / uRouteSampleCount, routeY)
    );
    vec2 heading = normalize(mix(first.zw, second.zw, blend));
    return vec4(mix(first.xy, second.xy, blend), heading);
  }

  vec3 surfacePositionAt(float time) {
    if (aRouteHandle.x < 0.0) return position;
    vec4 route = routeSampleAt(aRouteHandle.x, time, aRouteHandle.y);
    vec3 result = rotateY(position, route.zw);
    result.x += route.x;
    result.z += route.y;
    return result;
  }

  void main() {
    float age = mod(uTime + aPhase, aLifetime);
    float flightAge = max(0.0, age - aAttachmentSeconds);
    float release = aAttachmentSeconds == 0.0
      ? 1.0
      : smoothRange(0.0, 0.42, flightAge);
    float surfaceTime = uTime - flightAge;
    vec3 anchor = surfacePositionAt(surfaceTime);

    vec3 wind = normalize(vec3(0.82, 0.12, -0.46));
    vec3 crossWind = normalize(vec3(-wind.z, 0.0, wind.x));
    float streamCoordinate = dot(anchor, vec3(0.31, 0.73, -0.24));
    float broadWave = sin(uTime * 0.52 + streamCoordinate * 0.85);
    float detailWave = sin(uTime * 1.18 + streamCoordinate * 2.1) * 0.34;
    float gust = broadWave + detailWave;
    float lift = sin(uTime * 0.63 + streamCoordinate * 1.05);

    vec3 flowPosition = anchor + wind * flightAge * WIND_SPEED;
    flowPosition += crossWind * gust * min(0.26, flightAge * 0.055);
    flowPosition.y += lift * min(0.18, flightAge * 0.035);
    vec3 animatedPosition = mix(anchor, flowPosition, release);

    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * uPixelRatio * (4.0 / max(1.0, -viewPosition.z));

    float birth = smoothRange(0.0, 0.12, age);
    float death = 1.0 - smoothRange(aLifetime - 0.65, aLifetime, age);
    vColor = aColor;
    vOpacity = birth * death * mix(0.34, 1.0, release);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    float circle = 1.0 - smoothstep(0.28, 0.5, distanceToCenter);
    gl_FragColor = vec4(vColor, circle * vOpacity * 0.58);
  }
`;

export type NumberRange = Readonly<{
  minimum: number;
  maximum: number;
}>;

export type ScentParticleSettings = Readonly<{
  attachmentSeconds: NumberRange;
  lifetimeSeconds: NumberRange;
  pointSize: NumberRange;
  color: NumberRange;
}>;

export type ScentEmitter =
  | Readonly<{ kind: "static"; transform: Matrix4 }>
  | Readonly<{ kind: "route"; routeHandle: MovementRouteHandle }>;

export type ScentSource = Readonly<{
  samplingSurface: BufferGeometry;
  emitters: readonly ScentEmitter[];
  particleSettings: ScentParticleSettings;
}>;

export class ScentParticles {
  readonly sceneObject: Points<BufferGeometry, ShaderMaterial>;

  private readonly fallbackRouteTexture = createFallbackRouteTexture();
  private renderedCount = 0;

  constructor(pixelRatio: number, maximumEmitterCount: number) {
    const geometry = createParticleGeometry(maximumEmitterCount * MAX_PARTICLES_PER_EMITTER);
    this.sceneObject = new Points(
      geometry,
      createParticleMaterial(pixelRatio, this.fallbackRouteTexture),
    );
    this.sceneObject.frustumCulled = false;
    this.sceneObject.renderOrder = 10;
    this.sceneObject.geometry.setDrawRange(0, 0);
  }

  resample(
    sources: readonly ScentSource[],
    particlesPerEmitter: number,
    routeAtlas?: MovementRouteAtlas,
  ): void {
    const particleCount = clampParticlesPerEmitter(particlesPerEmitter);
    this.setRouteAtlas(routeAtlas);
    this.renderedCount = sampleSources(
      getParticleAttributes(this.sceneObject.geometry),
      sources,
      particleCount,
    );
    this.sceneObject.geometry.setDrawRange(0, this.renderedCount);
  }

  getRenderedParticleCount(): number {
    return this.renderedCount;
  }

  setTime(time: number): void {
    this.sceneObject.material.uniforms.uTime!.value = time;
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

type EmitterSamplingSettings = Readonly<{
  sampler: MeshSurfaceSampler;
  emitter: ScentEmitter;
  attributes: ParticleAttributes;
  startIndex: number;
  particleCount: number;
  propertySampler: ParticlePropertySampler;
}>;

type ParticlePropertySampler = Readonly<{
  settings: ScentParticleSettings;
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

function clampParticlesPerEmitter(count: number): number {
  return Math.min(
    MAX_PARTICLES_PER_EMITTER,
    Math.max(MIN_PARTICLES_PER_EMITTER, Math.floor(count)),
  );
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

function sampleSources(
  attributes: ParticleAttributes,
  sources: readonly ScentSource[],
  particlesPerEmitter: number,
): number {
  let particleIndex = 0;
  for (const source of sources) {
    const sampler = new MeshSurfaceSampler(new Mesh(source.samplingSurface)).build();
    const propertySampler = createParticlePropertySampler(source.particleSettings);
    for (const emitter of source.emitters) {
      particleIndex = sampleEmitter({
        sampler,
        emitter,
        attributes,
        startIndex: particleIndex,
        particleCount: particlesPerEmitter,
        propertySampler,
      });
    }
  }
  markAttributesForUpdate(attributes);
  return particleIndex;
}

function sampleEmitter(settings: EmitterSamplingSettings): number {
  const { sampler, emitter, attributes, startIndex, particleCount, propertySampler } =
    settings;
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
    emitter.routeHandle.duration,
  );
}

function writeParticleProperties(
  attributes: ParticleAttributes,
  index: number,
  sampler: ParticlePropertySampler,
): void {
  const lifetime = sampleNumberRange(sampler.settings.lifetimeSeconds);
  const color = sampler.sampledColor
    .copy(sampler.minimumColor)
    .lerp(sampler.maximumColor, Math.random());
  attributes.attachmentSeconds.setX(
    index,
    sampleNumberRange(sampler.settings.attachmentSeconds),
  );
  attributes.color.setXYZ(index, color.r, color.g, color.b);
  attributes.lifetime.setX(index, lifetime);
  attributes.phase.setX(index, Math.random() * lifetime);
  attributes.size.setX(index, sampleNumberRange(sampler.settings.pointSize));
}

function createParticlePropertySampler(
  settings: ScentParticleSettings,
): ParticlePropertySampler {
  return {
    settings,
    minimumColor: new Color(settings.color.minimum),
    maximumColor: new Color(settings.color.maximum),
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

function createParticleMaterial(pixelRatio: number, fallbackRouteTexture: DataTexture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
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
