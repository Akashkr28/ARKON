import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';
import { HOLOGRAM } from '../config';

// The #include lines are three.js's own clipping chunks, so section planes cut this
// material like the built-in ones (they need the view-space position named mvPosition).
const vertexShader = /* glsl */ `
  #include <clipping_planes_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPosition.xyz);
    vWorldY = (modelMatrix * vec4(position, 1.0)).y;
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <clipping_planes_pars_fragment>
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uBaseOpacity;
  uniform float uFresnelPower;
  uniform float uFresnelStrength;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;

  void main() {
    #include <clipping_planes_fragment>
    // Fresnel: surfaces seen edge-on glow, surfaces facing the camera stay faint.
    float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
    float fresnel = pow(1.0 - facing, uFresnelPower) * uFresnelStrength;

    float scanline = 0.85 + 0.15 * sin(vWorldY * 80.0 - uTime * 3.0);

    // A brighter band that sweeps slowly up the model, like a projector refresh.
    float sweepPosition = fract(vWorldY * 0.35 - uTime * 0.12) - 0.5;
    float sweep = exp(-sweepPosition * sweepPosition * 140.0) * 0.5;

    float flicker = 0.96 + 0.04 * sin(uTime * 37.0) * sin(uTime * 13.0);
    float intensity = (uBaseOpacity + fresnel + sweep) * scanline * flicker;

    // Colour above 1.0 is intentional: it's what the bloom pass picks up.
    gl_FragColor = vec4(uColor * intensity * 1.6, clamp(intensity, 0.0, 1.0));
  }
`;

export function createHologramMaterial(color = HOLOGRAM.color) {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uBaseOpacity: { value: HOLOGRAM.baseOpacity },
      uFresnelPower: { value: HOLOGRAM.fresnelPower },
      uFresnelStrength: { value: HOLOGRAM.fresnelStrength },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    clipping: true,
  });
}
