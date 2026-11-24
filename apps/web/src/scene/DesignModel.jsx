import { useEffect, useMemo } from 'react';
import { useDesignStore } from '../store/designStore';
import { LoadedModel } from './ModelViewer';
import DesignHandles from './DesignHandles';
import { designObject, disposeObject } from './designObject';
import { applyAppearance } from './applyAppearance';

// The part from the DESIGN workspace, shown through the same viewer as any model:
// hologram, selection, measuring, section planes and navigation all work on it.
export default function DesignModel() {
  const part = useDesignStore((s) => s.part);
  const name = useDesignStore((s) => s.name);
  const frame = useDesignStore((s) => s.frame);
  const appearance = useDesignStore((s) => s.appearance);

  // The name is read at build time only; renaming doesn't need new geometry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => (part ? designObject(part, name) : null), [part]);

  useEffect(() => () => disposeObject(scene), [scene]);
  useEffect(() => applyAppearance(scene, appearance), [scene, appearance]);
  return scene ? (
    <LoadedModel scene={scene} frame={frame} overlay={(content) => <DesignHandles content={content} />} />
  ) : null;
}
