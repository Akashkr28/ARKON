import { useShallow } from 'zustand/react/shallow';
import { useViewerStore } from '../store/viewerStore';
import { flipSection, setSectionAxis, setSectionOffset, toggleSectionPlane } from '../actions/viewerActions';
import { SECTION_AXES, sectionPosition } from '../scene/sectionPlane';
import { formatLength } from '../units';

const AXIS_HINT = { x: 'left–right', y: 'top–bottom', z: 'front–back' };

export default function SectionControls() {
  const { section, bounds, showPlane, unit } = useViewerStore(
    useShallow((s) => ({
      section: s.section,
      bounds: s.modelBounds,
      showPlane: s.showSectionPlane,
      unit: s.lengthUnit,
    })),
  );

  return (
    <div className="section-controls">
      <div className="section-row">
        <span className="section-label">SECTION</span>
        {SECTION_AXES.map((axis) => (
          <button
            key={axis}
            type="button"
            className={`view-button section-axis${section.axis === axis ? ' is-active' : ''}`}
            onClick={() => setSectionAxis(section.axis === axis ? null : axis)}
            title={`Cut ${AXIS_HINT[axis]} (S cycles X → Y → Z → off)`}
            disabled={!bounds}
          >
            {axis.toUpperCase()}
          </button>
        ))}
      </div>
      {section.axis && bounds && (
        <>
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={section.offset}
            onChange={(e) => setSectionOffset(Number(e.target.value))}
            aria-label="Section position"
          />
          <div className="section-row">
            <span className="section-position">
              {section.axis.toUpperCase()} = {formatLength(sectionPosition(section, bounds), unit, { precise: true })}
            </span>
            <button type="button" className="view-button" onClick={flipSection} title="Keep the other side">
              ⇄ FLIP
            </button>
            <button
              type="button"
              className={`view-button${showPlane ? ' is-on' : ''}`}
              onClick={toggleSectionPlane}
              title="Show or hide the plane outline"
            >
              ▭
            </button>
          </div>
        </>
      )}
    </div>
  );
}
