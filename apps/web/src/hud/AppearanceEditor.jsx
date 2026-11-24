import { FINISHES, surfaceOf } from '../cad/appearance';
import { MATERIAL_LIBRARY } from '../config';

// Material, colour and finish of a part. For a model (paint = true) there's no material
// (its CAD file's materials and masses stay); "Original" removes the paint.
export default function AppearanceEditor({ appearance, onChange, paint = false }) {
  const shown = appearance ? surfaceOf(appearance).color : '#9aa4ad';
  return (
    <div className="design-editor appearance-editor">
      {!paint && (
        <label className="design-field">
          <span>Material</span>
          <select
            value={appearance?.materialId ?? ''}
            onChange={(e) => onChange({ materialId: e.target.value, color: null })}
            aria-label="Material"
          >
            {MATERIAL_LIBRARY.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.density.toLocaleString('en-US')} kg/m³
              </option>
            ))}
          </select>
        </label>
      )}
      {paint && (
        <label className="design-field">
          <span>Look</span>
          <select
            value={appearance ? 'paint' : 'original'}
            onChange={(e) => onChange(e.target.value === 'paint' ? { color: shown, finish: 'satin' } : null)}
            aria-label="Look"
          >
            <option value="original">Original (from the CAD file)</option>
            <option value="paint">Painted</option>
          </select>
        </label>
      )}
      {(!paint || appearance) && (
        <>
          <label className="design-field">
            <span>Colour</span>
            <span className="design-input">
              <input
                type="color"
                className="appearance-color"
                value={shown}
                onChange={(e) => onChange({ color: e.target.value })}
                aria-label="Colour"
              />
              {!paint && appearance?.color && (
                <button type="button" className="appearance-reset" onClick={() => onChange({ color: null })} title="Back to the material's own colour">
                  ↺
                </button>
              )}
            </span>
          </label>
          <div className="design-field" role="radiogroup" aria-label="Finish">
            <span>Finish</span>
            <span className="design-actions">
              {Object.entries(FINISHES).map(([id, finish]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={appearance?.finish === id}
                  className={appearance?.finish === id ? 'is-active' : undefined}
                  onClick={() => onChange({ finish: id })}
                >
                  {finish.label.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
