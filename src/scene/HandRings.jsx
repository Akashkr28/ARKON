import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { useHandStore } from '../store/handStore';
import { useViewerStore } from '../store/viewerStore';
import { RINGS, VIEW } from '../config';

const MAX_HANDS = 2;
const COLORS = { Left: new Color(RINGS.leftColor), Right: new Color(RINGS.rightColor) };

// Unit-radius geometries, shared by every rig and scaled per frame.
const geometries = {
  arc: new RingGeometry(0.9, 1, 48, 1, 0, Math.PI * 0.55),
  inner: new RingGeometry(0.62, 0.66, 64),
  tip: new RingGeometry(0.7, 1, 32),
  pulse: new RingGeometry(0.88, 1, 64),
};

function glowMaterial() {
  return new MeshBasicMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
}

function addMesh(parent, geometry, material) {
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 10; // drawn over the model
  parent.add(mesh);
  return mesh;
}

// One rig per hand: dashed spinning ring + inner ring on the palm, a small ring on
// the index tip, and a ring that bursts outward when a pinch starts.
function createRig() {
  const material = glowMaterial();
  const pulseMaterial = glowMaterial();
  const root = new Group();

  const palm = new Group();
  const spinner = new Group();
  for (let i = 0; i < 3; i++) {
    addMesh(spinner, geometries.arc, material).rotation.z = (i * Math.PI * 2) / 3;
  }
  palm.add(spinner);
  const inner = addMesh(palm, geometries.inner, material);
  root.add(palm);

  const tip = addMesh(root, geometries.tip, material);
  const pulse = addMesh(root, geometries.pulse, pulseMaterial);
  pulse.visible = false;

  return { root, palm, spinner, inner, tip, pulse, material, pulseMaterial, handId: null, wasPinching: false, pulseStart: -Infinity };
}

// Keep each rig attached to the same physical hand across frames.
function assignRigs(rigs, hands) {
  const ids = new Set(hands.map((h) => h.id));
  for (const rig of rigs) if (!ids.has(rig.handId)) rig.handId = null;
  for (const hand of hands) {
    if (rigs.some((r) => r.handId === hand.id)) continue;
    const free = rigs.find((r) => r.handId === null);
    if (free) {
      free.handId = hand.id;
      free.wasPinching = hand.pinching;
    }
  }
}

function updateRig(rig, hand, active, worldPerPixel, time, dt) {
  const color = COLORS[hand.handedness];
  rig.material.color.copy(color);
  rig.pulseMaterial.color.copy(color);
  rig.material.opacity = active ? 1 : 0.5;

  const radius = hand.palmSizeScreen * RINGS.palmRadius * worldPerPixel;
  rig.palm.position.set(hand.palmWorld.x, hand.palmWorld.y, hand.palmWorld.z);
  rig.palm.scale.setScalar(radius);
  rig.spinner.rotation.z += dt * (active ? 3 : 0.8);
  rig.inner.scale.setScalar(0.7 + 0.3 * hand.openness);

  const tipPoint = hand.pinching ? hand.pinchWorld : hand.indexTipWorld;
  rig.tip.position.set(tipPoint.x, tipPoint.y, tipPoint.z);
  rig.tip.scale.setScalar(radius * (hand.pinching ? 0.32 : 0.2));

  if (hand.pinching && !rig.wasPinching) rig.pulseStart = time;
  rig.wasPinching = hand.pinching;

  const age = (time - rig.pulseStart) / RINGS.pulseSeconds;
  rig.pulse.visible = age >= 0 && age < 1;
  if (rig.pulse.visible) {
    rig.pulse.position.copy(rig.tip.position);
    rig.pulse.scale.setScalar(radius * (0.3 + age * 1.2));
    rig.pulseMaterial.opacity = 1 - age;
  }
}

export default function HandRings() {
  const rigs = useMemo(() => Array.from({ length: MAX_HANDS }, createRig), []);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    for (const rig of rigs) scene.add(rig.root);
    return () => {
      for (const rig of rigs) {
        scene.remove(rig.root);
        rig.material.dispose();
        rig.pulseMaterial.dispose();
      }
    };
  }, [rigs, scene]);

  useFrame((state, dt) => {
    const { hands, activeHandIds } = useHandStore.getState();
    const modelZ = useViewerStore.getState().position[2];
    // Scene units per screen pixel on the plane where the hands are projected.
    const halfHeight = Math.tan((VIEW.cameraFov * Math.PI) / 360) * (VIEW.cameraZ - modelZ);
    const worldPerPixel = (2 * halfHeight) / state.size.height;

    assignRigs(rigs, hands);
    for (const rig of rigs) {
      const hand = hands.find((h) => h.id === rig.handId);
      rig.root.visible = Boolean(hand);
      if (hand) {
        updateRig(rig, hand, activeHandIds.includes(hand.id), worldPerPixel, state.clock.elapsedTime, dt);
      }
    }
  });

  return null;
}
