import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useViewerStore } from '../store/viewerStore';
import { useHandStore } from '../store/handStore';
import HandCards from './HandCards';
import RadialMenu from './RadialMenu';
import HandCursors from './HandCursors';
import GesturePicker from './GesturePicker';
import PartInfoCard from './PartInfoCard';
import GestureLegend from './GestureLegend';
import LibraryPanel from './LibraryPanel';
import DropOverlay from './DropOverlay';
import QualityHint from './QualityHint';
import ViewToolbar from './ViewToolbar';
import MeasurePanel from './MeasurePanel';
import AssemblyTree from './AssemblyTree';
import SpecSheet, { SpecsLoader } from './SpecSheet';
import InspectTooltip from './InspectTooltip';
import ViewScale from './ViewScale';
import DesignPanel from './DesignPanel';
import { openDesign } from '../actions/designActions';
import { openAssembly } from '../actions/assemblyActions';
import AssemblyPanel from './AssemblyPanel';
import { useAssemblyStore } from '../store/assemblyStore';
import { useDesignStore } from '../store/designStore';
import { setHudTab, useUiStore } from '../store/uiStore';
import { formatSize } from '../units';
import * as actions from '../actions/viewerActions';
import { changeQuality, quality } from '../quality';
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../config';
import './hud.css';

function ToggleButton({ label, hotkey, active, onClick }) {
  return (
    <button type="button" className={`hud-toggle${active ? ' is-active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {hotkey && <kbd>{hotkey}</kbd>}
    </button>
  );
}

function ControlPanel() {
  // Only the fields the panel shows, so per-frame state (rotation, spin) doesn't re-render it.
  const s = useViewerStore(
    useShallow((state) => ({
      mirror: state.mirror,
      grayscale: state.grayscale,
      labels: state.labels,
      debug: state.debug,
      materialMode: state.materialMode,
      dim: state.dim,
      cameras: state.cameras,
      activeCameraId: state.activeCameraId,
    })),
  );

  return (
    <div className="hud-panel hud-controls">
      <ToggleButton label="MIRROR" hotkey="F" active={s.mirror} onClick={actions.toggleMirror} />
      <ToggleButton label="B&W" hotkey="B" active={s.grayscale} onClick={actions.toggleGrayscale} />
      <ToggleButton label="LABELS" hotkey="L" active={s.labels} onClick={actions.toggleLabels} />
      <ToggleButton label="DEBUG" hotkey="D" active={s.debug} onClick={actions.toggleDebug} />
      <ToggleButton
        label={s.materialMode === 'hologram' ? 'HOLOGRAM' : 'ORIGINAL'}
        hotkey="M"
        active={s.materialMode === 'hologram'}
        onClick={actions.toggleMaterialMode}
      />

      <label className="hud-field">
        <span>DIM {Math.round(s.dim * 100)}%</span>
        <input
          type="range"
          min="0"
          max="0.8"
          step="0.05"
          value={s.dim}
          onChange={(e) => actions.setDim(Number(e.target.value))}
        />
      </label>

      <label className="hud-field">
        <span>QUALITY</span>
        <select
          value={quality.auto ? 'auto' : quality.level}
          onChange={(e) => changeQuality(e.target.value)}
          title={QUALITY_PRESETS[quality.level].description}
        >
          <option value="auto">AUTO · {QUALITY_PRESETS[quality.level].label}</option>
          {QUALITY_LEVELS.map((level) => (
            <option key={level} value={level}>
              {QUALITY_PRESETS[level].label}
            </option>
          ))}
        </select>
      </label>

      <label className="hud-field">
        <span>
          CAMERA <kbd>C</kbd>
        </span>
        <select
          value={s.activeCameraId ?? ''}
          onChange={(e) => actions.selectCamera(e.target.value)}
          disabled={s.cameras.length === 0}
        >
          {s.cameras.length === 0 && <option value="">—</option>}
          {s.cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const TRACKER_TEXT = {
  idle: 'TRACKING OFF',
  loading: 'LOADING HAND TRACKING…',
  ready: 'TRACKING ONLINE',
  error: 'TRACKING OFFLINE',
};

function StatusLine() {
  const modelStatus = useViewerStore((s) => s.modelStatus);
  const partCount = useViewerStore((s) => Object.keys(s.parts).length);
  const exploded = useViewerStore((s) => s.explodeTarget > 0.05);
  const modelSize = useViewerStore((s) => s.modelSize);
  const unit = useViewerStore((s) => s.lengthUnit);
  const trackerStatus = useHandStore((s) => s.status);
  const gestureState = useHandStore((s) => s.gestureState);

  const designing = useUiStore((s) => s.workspace === 'design');
  const assembling = useUiStore((s) => s.workspace === 'assemble');
  const assemblyName = useAssemblyStore((s) => s.name);
  const assemblyCounts = useAssemblyStore((s) => `${s.components.length} PARTS · ${s.mates.length} MATES`);
  const designName = useDesignStore((s) => s.name);
  const designSize = useDesignStore((s) => s.part?.properties.sizeMm);

  if (assembling) {
    return (
      <div className="hud-panel hud-status">
        ASSEMBLY · {assemblyName.toUpperCase()} · {assemblyCounts} · {TRACKER_TEXT[trackerStatus]}
      </div>
    );
  }

  if (designing) {
    const size = designSize
      ? ` · ${formatSize(
          designSize.map((mm) => mm / 1000),
          unit,
        ).toUpperCase()}`
      : '';
    return (
      <div className="hud-panel hud-status">
        DESIGN · {designName.toUpperCase()}
        {size} · {TRACKER_TEXT[trackerStatus]}
      </div>
    );
  }

  const modelText =
    modelStatus === 'loading'
      ? 'LOADING MODEL…'
      : modelStatus === 'ready'
        ? `MODEL ONLINE · ${partCount} PARTS${modelSize ? ` · ${formatSize(modelSize, unit).toUpperCase()}` : ''}${exploded ? ' · EXPLODED' : ''}`
        : 'MODEL OFFLINE';

  return (
    <div className="hud-panel hud-status">
      {modelText} · {TRACKER_TEXT[trackerStatus]}
      {trackerStatus === 'ready' && <span className="hud-gesture-state"> · {gestureState}</span>}
    </div>
  );
}

const TABS = [
  ['parts', 'PARTS'],
  ['specs', 'SPECS'],
  ['library', 'LIBRARY'],
  ['display', 'DISPLAY'],
];

// Tabs keep the right side to one panel at a time instead of a growing stack.
function RightPanel() {
  const tab = useUiStore((s) => s.hudTab);
  const workspace = useUiStore((s) => s.workspace);
  const [designTab, setDesignTab] = useState('design');
  if (workspace !== 'view') {
    const main = workspace === 'design' ? ['design', 'DESIGN'] : ['design', 'ASSEMBLE'];
    return (
      <>
        <div className="hud-panel hud-tabs" role="tablist">
          {[main, ['display', 'DISPLAY']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={designTab === id}
              className={`hud-tab${designTab === id ? ' is-active' : ''}`}
              onClick={() => setDesignTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {designTab !== 'design' ? <ControlPanel /> : workspace === 'design' ? <DesignPanel /> : <AssemblyPanel />}
      </>
    );
  }
  return (
    <>
      <div className="hud-panel hud-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`hud-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setHudTab(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={false}
          className="hud-tab hud-tab-design"
          onClick={openDesign}
          title="Make your own part"
        >
          DESIGN
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          className="hud-tab hud-tab-design"
          onClick={openAssembly}
          title="Put parts together"
        >
          ASSEMBLE
        </button>
      </div>
      {tab === 'parts' && <AssemblyTree />}
      {tab === 'specs' && <SpecSheet />}
      {tab === 'library' && <LibraryPanel />}
      {tab === 'display' && <ControlPanel />}
    </>
  );
}

export default function Hud() {
  const wide = useUiStore((s) => s.hudTab === 'specs' || s.workspace !== 'view');
  return (
    <div className="hud">
      <SpecsLoader />
      <InspectTooltip />
      <HandCards />
      <RadialMenu />
      <StatusLine />
      <PartInfoCard />
      <div className={`hud-right${wide ? ' is-wide' : ''}`}>
        <RightPanel />
      </div>
      <ViewToolbar />
      <MeasurePanel />
      <ViewScale />
      <GestureLegend />
      <QualityHint />
      <DropOverlay />
      <GesturePicker />
      <HandCursors />
    </div>
  );
}
