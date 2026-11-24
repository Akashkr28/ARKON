import { useShallow } from 'zustand/react/shallow';
import { describeItem, productForSpec } from '../models/partFaces';
import { useSpecStore } from '../store/specStore';
import { useViewerStore } from '../store/viewerStore';

// Follows the cursor while the inspector is on (SPECS tab): what the face or edge is.
export default function InspectTooltip() {
  const { hover, faces } = useSpecStore(useShallow((s) => ({ hover: s.hover, faces: s.faces })));
  const unit = useViewerStore((s) => s.lengthUnit);
  const partName = useViewerStore((s) => (hover ? s.parts[hover.partId]?.name : null));
  if (!hover) return null;
  const described = describeItem(productForSpec(faces, hover.specIndex), hover, unit);
  if (!described) return null;
  return (
    <div className="inspect-tooltip" style={{ left: hover.x + 16, top: hover.y + 16 }} role="status">
      <div className="spec-strong">{described.title}</div>
      {described.details.map((line) => (
        <div key={line}>{line}</div>
      ))}
      <div className="spec-muted">{partName} · click to keep</div>
    </div>
  );
}
