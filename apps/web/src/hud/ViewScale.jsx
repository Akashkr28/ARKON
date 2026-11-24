import { useShallow } from 'zustand/react/shallow';
import { VIEW } from '../config';
import { metresPerPixel, scaleBar } from '../models/scaleBar';
import { useCursorStore } from '../store/cursorStore';
import { useUiStore } from '../store/uiStore';
import { useViewerStore } from '../store/viewerStore';
import { formatLength } from '../units';

// Bottom right: a scale bar that follows the zoom (measured at the depth of the surface
// last hovered), the ruler grid's spacing, and the coordinates under the cursor.
export default function ViewScale() {
  const { scale, metresPerSceneUnit, position, unit, parts, ready } = useViewerStore(
    useShallow((s) => ({
      scale: s.scale,
      metresPerSceneUnit: s.metresPerSceneUnit,
      position: s.position,
      unit: s.lengthUnit,
      parts: s.parts,
      ready: s.modelStatus === 'ready',
    })),
  );
  const { point, depth } = useCursorStore(useShallow((s) => ({ point: s.point, depth: s.depth })));
  const grid = useUiStore((s) => s.grid);
  // Beside the right panel when it's the wide kind (SPECS, DESIGN), not on top of it.
  const shifted = useUiStore((s) => s.hudTab === 'specs' || s.workspace !== 'view');
  if (!ready) return null;

  const mpp = metresPerPixel({
    depth: depth ?? VIEW.cameraZ - position[2],
    scale,
    metresPerSceneUnit,
    viewportHeight: window.innerHeight,
  });
  const bar = scaleBar(mpp, unit);
  const gridStep = scaleBar(mpp, unit, VIEW.gridCellPx);

  return (
    <div className={`hud-panel view-scale${shifted ? ' is-shifted' : ''}`} aria-label="View scale">
      <div className="scale-bar-row">
        <span className="scale-bar" style={{ width: `${Math.round(bar.pixels)}px` }} />
        <span className="scale-bar-label">{bar.label}</span>
        {grid && <span className="scale-grid">GRID {gridStep.label}</span>}
      </div>
      <div className="cursor-readout" aria-label="Cursor position">
        {point ? (
          <>
            {point.metres.map((v, i) => `${'XYZ'[i]} ${formatLength(v, unit, { precise: true })}`).join('  ')}
            <span className="cursor-part"> · {parts[point.partId]?.name}</span>
          </>
        ) : (
          <span className="spec-muted">Hover the model for coordinates (Y up) · G grid</span>
        )}
      </div>
    </div>
  );
}
