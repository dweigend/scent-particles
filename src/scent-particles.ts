/**
 * Implements a continuous, single-drawcall scent stream for instanced static meshes.
 * CPU work is limited to explicit resampling; lifetime, rebirth, and wind run on the GPU.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

export const MIN_PARTICLES_PER_TREE = 100;
export const MAX_PARTICLES_PER_TREE = 5_000;
export const DEFAULT_PARTICLES_PER_TREE = 1_000;

const SURFACE_OFFSET = 0.012;

const vertexShader = /* glsl */ `
  attribute float aLifetime;
  attribute float aPhase;
  attribute float aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uPixelRatio;

  varying float vSeed;
  varying float vOpacity;

  const float ATTACH_DURATION = 1.0;
  const float WIND_SPEED = 0.38;

  float smoothRange(float start, float end, float value) {
    float t = clamp((value - start) / (end - start), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  void main() {
    float age = mod(uTime + aPhase, aLifetime);
    float flightAge = max(0.0, age - ATTACH_DURATION);
    float release = smoothRange(0.0, 0.42, flightAge);

    vec3 wind = normalize(vec3(0.82, 0.12, -0.46));
    vec3 crossWind = normalize(vec3(-wind.z, 0.0, wind.x));
    float streamCoordinate = dot(position, vec3(0.31, 0.73, -0.24));
    float broadWave = sin(uTime * 0.52 + streamCoordinate * 0.85);
    float detailWave = sin(uTime * 1.18 + streamCoordinate * 2.1) * 0.34;
    float gust = broadWave + detailWave;
    float lift = sin(uTime * 0.63 + streamCoordinate * 1.05);

    vec3 flowPosition = position + wind * flightAge * WIND_SPEED;
    flowPosition += crossWind * gust * min(0.26, flightAge * 0.055);
    flowPosition.y += lift * min(0.18, flightAge * 0.035);
    vec3 animatedPosition = mix(position, flowPosition, release);

    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = aSize * uPixelRatio * (4.0 / max(1.0, -viewPosition.z));

    float birth = smoothRange(0.0, 0.12, age);
    float death = 1.0 - smoothRange(aLifetime - 0.65, aLifetime, age);
    vSeed = aSeed;
    vOpacity = birth * death * mix(0.34, 1.0, release);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vSeed;
  varying float vOpacity;

  float hash(float value) {
    return fract(sin(value) * 43758.5453123);
  }

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    float circle = 1.0 - smoothstep(0.28, 0.5, distanceToCenter);
    vec3 forestGreen = vec3(0.08, 0.46, 0.18);
    vec3 leafGreen = vec3(0.36, 0.94, 0.45);
    vec3 color = mix(forestGreen, leafGreen, hash(vSeed * 5.73));
    gl_FragColor = vec4(color, circle * vOpacity * 0.58);
  }
`;

export class ScentParticles {
  readonly object: Points<BufferGeometry, ShaderMaterial>;

  private particlesPerTree = DEFAULT_PARTICLES_PER_TREE;
  private renderedCount = 0;

  constructor(pixelRatio: number, maximumTreeCount: number) {
    const geometry = createParticleGeometry(maximumTreeCount * MAX_PARTICLES_PER_TREE);
    this.object = new Points(geometry, createParticleMaterial(pixelRatio));
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.object.geometry.setDrawRange(0, 0);
  }

  sample(
    surface: BufferGeometry,
    placements: readonly Matrix4[],
    particlesPerTree: number,
  ): void {
    if (placements.length === 0) return;
    this.particlesPerTree = clampParticlesPerTree(particlesPerTree);
    const sampler = new MeshSurfaceSampler(new Mesh(surface)).build();
    const normalMatrices = placements.map((matrix) => new Matrix3().getNormalMatrix(matrix));
    this.renderedCount = this.sampleAll(sampler, placements, normalMatrices);
    this.object.geometry.setDrawRange(0, this.renderedCount);
  }

  getCount(): number {
    return this.renderedCount;
  }

  setTime(time: number): void {
    this.object.material.uniforms.uTime!.value = time;
  }

  setPixelRatio(pixelRatio: number): void {
    this.object.material.uniforms.uPixelRatio!.value = pixelRatio;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  private sampleAll(
    sampler: MeshSurfaceSampler,
    placements: readonly Matrix4[],
    normalMatrices: readonly Matrix3[],
  ): number {
    const attributes = getParticleAttributes(this.object.geometry);
    const point = new Vector3();
    const normal = new Vector3();
    let particleIndex = 0;
    for (let treeIndex = 0; treeIndex < placements.length; treeIndex += 1) {
      for (let localIndex = 0; localIndex < this.particlesPerTree; localIndex += 1) {
        sampler.sample(point, normal);
        point.applyMatrix4(placements[treeIndex]!);
        normal.applyMatrix3(normalMatrices[treeIndex]!).normalize();
        point.addScaledVector(normal, SURFACE_OFFSET);
        attributes.position.setXYZ(particleIndex, point.x, point.y, point.z);
        setLifecycle(attributes, particleIndex);
        particleIndex += 1;
      }
    }
    markAttributesForUpdate(attributes);
    return particleIndex;
  }
}

type ParticleAttributes = Readonly<{
  position: BufferAttribute;
  lifetime: BufferAttribute;
  phase: BufferAttribute;
}>;

function createParticleGeometry(particleCapacity: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(particleCapacity * 3), 3));
  geometry.setAttribute("aLifetime", new BufferAttribute(new Float32Array(particleCapacity), 1));
  geometry.setAttribute("aPhase", new BufferAttribute(new Float32Array(particleCapacity), 1));
  geometry.setAttribute("aSeed", randomAttribute(particleCapacity));
  geometry.setAttribute("aSize", randomAttribute(particleCapacity, 10, 21));
  return geometry;
}

function randomAttribute(count: number, minimum = 0, maximum = 1): BufferAttribute {
  const values = new Float32Array(count);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = minimum + Math.random() * (maximum - minimum);
  }
  return new BufferAttribute(values, 1);
}

function clampParticlesPerTree(count: number): number {
  return Math.min(MAX_PARTICLES_PER_TREE, Math.max(MIN_PARTICLES_PER_TREE, Math.floor(count)));
}

function getParticleAttributes(geometry: BufferGeometry): ParticleAttributes {
  return {
    position: geometry.getAttribute("position") as BufferAttribute,
    lifetime: geometry.getAttribute("aLifetime") as BufferAttribute,
    phase: geometry.getAttribute("aPhase") as BufferAttribute,
  };
}

function setLifecycle(attributes: ParticleAttributes, index: number): void {
  const lifetime = 4 + Math.random() * 4;
  attributes.lifetime.setX(index, lifetime);
  attributes.phase.setX(index, Math.random() * lifetime);
}

function markAttributesForUpdate(attributes: ParticleAttributes): void {
  attributes.position.needsUpdate = true;
  attributes.lifetime.needsUpdate = true;
  attributes.phase.needsUpdate = true;
}

function createParticleMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: NormalBlending,
  });
}
