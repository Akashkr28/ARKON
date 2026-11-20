import { useViewerStore } from '../store/viewerStore';
import { dismissQualityHint } from '../actions/viewerActions';
import { changeQuality } from '../quality';
import { QUALITY_PRESETS } from '../config';

// Shown once if rendering stays slow: offer the next quality level down.
export default function QualityHint() {
  const level = useViewerStore((s) => s.qualityHint);
  if (!level) return null;

  return (
    <div className="hud-panel quality-hint" role="status">
      <span>
        Running slowly. Switch to <b>{QUALITY_PRESETS[level].label}</b> quality?
      </span>
      <button type="button" onClick={() => changeQuality(level)}>
        SWITCH
      </button>
      <button type="button" onClick={dismissQualityHint}>
        KEEP
      </button>
    </div>
  );
}
