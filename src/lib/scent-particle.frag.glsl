/* Draws each scent particle as a soft transparent circle. */

varying vec3 vColor;
varying float vOpacity;

void main() {
  float distanceToCenter = length(gl_PointCoord - vec2(0.5));
  float circle = 1.0 - smoothstep(0.28, 0.5, distanceToCenter);
  gl_FragColor = vec4(vColor, circle * vOpacity * 0.58);
}
