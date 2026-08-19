/* GPU lifecycle, route attachment, wind movement, and point sizing for scent particles. */

attribute float aAttachmentSeconds;
attribute vec3 aColor;
attribute float aLifetime;
attribute float aPhase;
attribute float aSize;
attribute vec2 aRouteHandle;

uniform float uTime;
uniform float uPixelRatio;
uniform vec3 uWindDirection;
uniform float uWindSpeed;
uniform sampler2D uRouteTexture;
uniform float uRouteSampleCount;
uniform float uRouteCount;

varying vec3 vColor;
varying float vOpacity;

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

vec4 routeSampleAt(float routeIndex, float elapsedSeconds, float durationSeconds) {
  float samplePosition = fract(elapsedSeconds / durationSeconds) * uRouteSampleCount;
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

  vec3 wind = normalize(uWindDirection);
  vec3 crossWind = normalize(vec3(-wind.z, 0.0, wind.x));
  float streamCoordinate = dot(anchor, vec3(0.31, 0.73, -0.24));
  float broadWave = sin(uTime * 0.52 + streamCoordinate * 0.85);
  float detailWave = sin(uTime * 1.18 + streamCoordinate * 2.1) * 0.34;
  float gust = broadWave + detailWave;
  float lift = sin(uTime * 0.63 + streamCoordinate * 1.05);

  vec3 flowPosition = anchor + wind * flightAge * uWindSpeed;
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
