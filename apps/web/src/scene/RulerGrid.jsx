import { useEffect, useMemo } from 'react';
import { createPortal } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { VIEW } from '../config';
import { metresPerPixel, scaleBar } from '../models/scaleBar';
import { useCursorStore } from '../store/cursorStore';
import { useUiStore } from '../store/uiStore';
import { useViewerStore } from '../store/viewerStore';
import { sectionPosition } from './sectionPlane';
import { gridLines } from '../models/rulerGrid';

const AXIS = { x: 0, y: 1, z: 2 };

function Lines({ positions, opacity }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  const material = useMemo(
    () => new LineBasicMaterial({ color: '#2ee6ff', transparent: true, opacity, depthWrite: false }),
    [opacity],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <lineSegments geometry={geometry} material={material} raycast={() => null} renderOrder={5} />;
}

// G: a ruler grid in real units, on the section plane when there is one (to read a cut
// inch by inch), else on the floor under the model. Cell size follows the zoom.
export default function RulerGrid({ content, bounds }) {
  const on = useUiStore((s) => s.grid);
  const { section, scale, metresPerSceneUnit, position, unit } = useViewerStore(
    useShallow((s) => ({
      section: s.section,
      scale: s.scale,
      metresPerSceneUnit: s.metresPerSceneUnit,
      position: s.position,
      unit: s.lengthUnit,
    })),
  );
  const { point, depth } = useCursorStore(useShallow((s) => ({ point: s.point, depth: s.depth })));
  if (!on || !bounds) return null;

  const mpp = metresPerPixel({
    depth: depth ?? VIEW.cameraZ - position[2],
    scale,
    metresPerSceneUnit,
    viewportHeight: window.innerHeight,
  });
  const step = scaleBar(mpp, unit, VIEW.gridCellPx).metres;
  if (!(step > 0)) return null;
  const axis = section.axis ? AXIS[section.axis] : 1;
  const level = section.axis ? sectionPosition(section, bounds) : bounds.min[1];
  const middle = bounds.min.map((v, i) => (v + bounds.max[i]) / 2);
  const centre = point?.metres ?? middle;
  return <GridAt content={content} axis={axis} level={level} centre={centre} step={step} bounds={bounds} />;
}

function GridAt({ content, axis, level, centre, step, bounds }) {
  // Rebuild only when the grid would actually change: the centre counts in whole cells.
  const key = [axis, level.toFixed(6), step, ...centre.map((c) => Math.round(c / step))].join('|');
  const lines = useMemo(
    () => gridLines({ axis, level, centre, step, half: VIEW.gridHalfCells, bounds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the inputs
    [key],
  );
  return createPortal(
    <group>
      <Lines positions={lines.minor} opacity={0.18} />
      <Lines positions={lines.major} opacity={0.5} />
    </group>,
    content,
  );
}
