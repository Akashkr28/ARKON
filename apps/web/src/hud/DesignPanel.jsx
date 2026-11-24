import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BASE_TYPES, FEATURE_TYPES, OPERATION_TYPES, describeFeature, visibleParams } from '../cad/features';
import { dimensionValue, isFormula, parseDimensionInput } from '../cad/parameters';
import {
  addFeature,
  addParameter,
  closeDesign,
  openDesignFile,
  removeParameter,
  renameParameter,
  saveDesignFile,
  setParameterExpression,
  exportDesignStep,
  exportDesignGlb,
  moveFeature,
  newDesign,
  refitDesign,
  removeFeature,
  renameDesign,
  saveDesignToLibrary,
  selectFeature,
  setFeatureParam,
  setDesignAppearance,
  toggleFeature,
} from '../actions/designActions';
import AppearanceEditor from './AppearanceEditor';
import { materialOf } from '../cad/appearance';
import { massKg } from '../models/partSpecs';
import { addDesignPart, openAssembly } from '../actions/assemblyActions';
import { useDesignStore } from '../store/designStore';
import { useViewerStore } from '../store/viewerStore';
import { formatArea, formatMass, formatSpecLength, formatVolume } from '../units';

const UNIT_LABEL = { length: 'mm', angle: '°', count: '' };

// A dimension field: a number, or a formula using parameters ("length - 2 * margin").
// Keeps what you type until it means something, instead of snapping mid-edit; a formula
// shows its result beside it.
function DimensionField({ value, values, onCommit, label, unit }) {
  const shown = isFormula(value) ? value.expr : String(value);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  const formula = isFormula(value);
  const result = formula ? dimensionValue(value, values) : null;
  return (
    <label className="design-field">
      <span>{label}</span>
      <span className={`design-input${formula ? ' is-formula' : ''}`}>
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          value={text}
          aria-label={label}
          title="A number, or a formula with parameters, e.g. length - 2 * margin"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(shown);
          }}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim() !== '') onCommit(parseDimensionInput(e.target.value));
          }}
        />
        {unit && <em>{unit}</em>}
      </span>
      {formula && (
        <span className={`design-result${result === null ? ' is-bad' : ''}`}>
          {result === null ? '= ?' : `= ${Number(result.toPrecision(6))}`}
        </span>
      )}
    </label>
  );
}

function FeatureEditor({ feature, values }) {
  return (
    <div className="design-editor" aria-label={`${FEATURE_TYPES[feature.type].label} settings`}>
      {visibleParams(feature).map((param) =>
        param.kind === 'choice' ? (
          <label key={param.key} className="design-field">
            <span>{param.label}</span>
            <select
              value={feature.params[param.key]}
              aria-label={param.label}
              onChange={(e) => setFeatureParam(feature.id, param.key, e.target.value)}
            >
              {param.options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <DimensionField
            key={param.key}
            label={param.label}
            unit={UNIT_LABEL[param.kind]}
            value={feature.params[param.key]}
            values={values}
            onCommit={(next) => setFeatureParam(feature.id, param.key, next)}
          />
        ),
      )}
    </div>
  );
}

function FeatureRow({ feature, resolved, index, count, selected, error }) {
  const base = FEATURE_TYPES[feature.type].base;
  return (
    <div
      className={`design-feature${selected ? ' is-selected' : ''}${feature.enabled ? '' : ' is-off'}${error ? ' has-error' : ''}`}
      onClick={() => selectFeature(feature.id)}
      role="listitem"
      aria-label={FEATURE_TYPES[feature.type].label}
    >
      <input
        type="checkbox"
        checked={feature.enabled}
        disabled={base}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggleFeature(feature.id)}
        aria-label={`Use ${FEATURE_TYPES[feature.type].label}`}
        title={base ? 'The base shape is always used' : 'Use / suppress this feature'}
      />
      <span className="design-feature-text">
        <strong>{FEATURE_TYPES[feature.type].label}</strong>
        <span>{describeFeature(resolved ?? feature)}</span>
        {error && <span className="design-error">{error}</span>}
      </span>
      {!base && (
        <span className="design-feature-buttons">
          <button
            type="button"
            disabled={index <= 1}
            onClick={(e) => (e.stopPropagation(), moveFeature(feature.id, -1))}
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            type="button"
            disabled={index >= count - 1}
            onClick={(e) => (e.stopPropagation(), moveFeature(feature.id, 1))}
            aria-label="Move down"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={(e) => (e.stopPropagation(), removeFeature(feature.id))}
            aria-label={`Delete ${FEATURE_TYPES[feature.type].label}`}
          >
            ✕
          </button>
        </span>
      )}
    </div>
  );
}

function ParametersTable({ parameters, values, errors }) {
  return (
    <div className="design-parameters" aria-label="Parameters">
      {parameters.map((p) => (
        <div key={p.id} className={`design-parameter${errors[p.id] ? ' has-error' : ''}`}>
          <TextField
            value={p.name}
            label="Parameter name"
            className="design-param-name"
            onCommit={(v) => renameParameter(p.id, v)}
          />
          <span>=</span>
          <TextField
            value={p.expression}
            label={`Value of ${p.name}`}
            className="design-param-expr"
            onCommit={(v) => setParameterExpression(p.id, v)}
          />
          <span className="design-result">{p.name in values ? Number(values[p.name].toPrecision(6)) : '?'}</span>
          <button type="button" onClick={() => removeParameter(p.id)} aria-label={`Delete ${p.name}`}>
            ✕
          </button>
          {errors[p.id] && <span className="design-error design-param-error">{errors[p.id]}</span>}
        </div>
      ))}
      <button type="button" className="design-add-param" onClick={addParameter}>
        + PARAMETER
      </button>
    </div>
  );
}

// A text input that keeps its own text while focused (no cursor jumps while the design
// re-renders around it).
function TextField({ value, label, className, onCommit }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <input
      className={className}
      value={text}
      spellCheck={false}
      aria-label={label}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(value);
      }}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(e.target.value);
      }}
    />
  );
}

function Properties({ properties, appearance }) {
  const unit = useViewerStore((s) => s.lengthUnit);
  const material = materialOf(appearance);
  const L = (mm) => formatSpecLength(mm, unit);
  return (
    <div className="design-properties" aria-label="Part properties">
      <dl className="spec-grid">
        <dt>SIZE</dt>
        <dd>{properties.sizeMm.map(L).join(' × ')}</dd>
        <dt>VOLUME</dt>
        <dd>{formatVolume(properties.volumeMm3, unit)}</dd>
        <dt>AREA</dt>
        <dd>{formatArea(properties.surfaceAreaMm2, unit)}</dd>
        <dt>FACES</dt>
        <dd>
          {properties.faces} (
          {Object.entries(properties.faceTypes)
            .map(([t, n]) => `${n} ${t}`)
            .join(', ')}
          )
        </dd>
        <dt>MASS</dt>
        <dd>
          <span className="spec-strong">{formatMass(massKg(properties.volumeMm3, material?.density), unit)}</span>
          {material && <span className="spec-muted"> in {material.name}</span>}
        </dd>
      </dl>
    </div>
  );
}

const STATUS_TEXT = {
  loading: 'Starting the design engine… (first time: a few seconds)',
  building: 'Rebuilding…',
};

export default function DesignPanel() {
  const d = useDesignStore(
    useShallow((s) => ({
      kernel: s.kernel,
      name: s.name,
      features: s.features,
      resolvedFeatures: s.resolvedFeatures,
      parameters: s.parameters,
      values: s.values,
      parameterErrors: s.parameterErrors,
      selectedFeatureId: s.selectedFeatureId,
      errors: s.errors,
      status: s.status,
      error: s.error,
      part: s.part,
      appearance: s.appearance,
      saving: s.saving,
      message: s.message,
    })),
  );
  const selected = d.features.find((f) => f.id === d.selectedFeatureId) ?? null;
  const busy = d.kernel === 'loading' ? STATUS_TEXT.loading : d.status === 'building' ? STATUS_TEXT.building : null;

  return (
    <div className="hud-panel hud-design" aria-label="Design">
      <div className="design-header">
        <input
          className="design-name"
          value={d.name}
          onChange={(e) => renameDesign(e.target.value)}
          aria-label="Part name"
        />
        <button type="button" onClick={closeDesign} title="Back to the model viewer">
          ◂ VIEWER
        </button>
      </div>
      <div className={`design-status${d.error ? ' library-error' : ''}`} role="status">
        {d.error ? `Design engine error: ${d.error}` : (busy ?? 'Edit any number: the part rebuilds as you type.')}
      </div>

      <div className="spec-section">FEATURES</div>
      <div className="design-features" role="list" aria-label="Features">
        {d.features.map((feature, index) => (
          <FeatureRow
            key={feature.id}
            feature={feature}
            resolved={d.resolvedFeatures.find((f) => f.id === feature.id)}
            index={index}
            count={d.features.length}
            selected={feature.id === d.selectedFeatureId}
            error={d.errors[feature.id]}
          />
        ))}
      </div>
      <div className="design-add">
        <select value="" onChange={(e) => e.target.value && addFeature(e.target.value)} aria-label="Add feature">
          <option value="">+ Add feature…</option>
          {OPERATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {FEATURE_TYPES[type].label}
            </option>
          ))}
        </select>
        <select value="" onChange={(e) => e.target.value && addFeature(e.target.value)} aria-label="Change base shape">
          <option value="">Base shape…</option>
          {BASE_TYPES.map((type) => (
            <option key={type} value={type}>
              {FEATURE_TYPES[type].label}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <>
          <div className="spec-section">{FEATURE_TYPES[selected.type].label.toUpperCase()}</div>
          <FeatureEditor feature={selected} values={d.values} />
        </>
      )}

      <div className="spec-section">PARAMETERS</div>
      <div className="spec-muted">Type a parameter name or formula into any dimension: length - 2 * margin</div>
      <ParametersTable parameters={d.parameters} values={d.values} errors={d.parameterErrors} />

      <div className="spec-section">MATERIAL & LOOK</div>
      <AppearanceEditor appearance={d.appearance} onChange={setDesignAppearance} />
      <div className="spec-muted">Shown in the ORIGINAL view (M); the material also sets the mass.</div>

      {d.part && (
        <>
          <div className="spec-section">PROPERTIES</div>
          <Properties properties={d.part.properties} appearance={d.appearance} />
        </>
      )}

      <div className="spec-section">SAVE</div>
      <div className="design-actions">
        <button
          type="button"
          onClick={exportDesignStep}
          disabled={!d.part || d.saving}
          title="Download as STEP (opens in any CAD program)"
        >
          {d.saving === 'step' ? 'STEP…' : 'EXPORT STEP'}
        </button>
        <button
          type="button"
          onClick={exportDesignGlb}
          disabled={!d.part || d.saving}
          title="The part as shown, with its colour and finish (.glb)"
        >
          {d.saving === 'glb' ? 'GLB…' : 'EXPORT GLB'}
        </button>
        <button
          type="button"
          onClick={saveDesignToLibrary}
          disabled={!d.part || d.saving}
          title="Convert through the library: exact specs, face data, BOM"
        >
          {d.saving === 'library' ? 'SAVING…' : 'SAVE TO LIBRARY'}
        </button>
        <button type="button" onClick={refitDesign} disabled={!d.part} title="Re-centre and fit the part on screen">
          RE-FIT
        </button>
        <button
          type="button"
          onClick={() => {
            addDesignPart();
            openAssembly();
          }}
          disabled={!d.part}
          title="Put a copy of this part into the assembly, with other parts"
        >
          USE IN ASSEMBLY
        </button>
        <button type="button" onClick={() => newDesign('box')} title="Start again from a plain box">
          NEW
        </button>
      </div>
      <DesignFiles />
      {d.message && <div className="design-message">{d.message}</div>}
    </div>
  );
}

// The design itself (features, parameters, formulas) as a file, to reopen and edit later.
function DesignFiles() {
  const input = useRef(null);
  return (
    <div className="design-actions">
      <button type="button" onClick={saveDesignFile} title="Download the editable design (.holocad.json)">
        SAVE DESIGN
      </button>
      <button type="button" onClick={() => input.current?.click()} title="Open a .holocad.json design">
        OPEN DESIGN
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Open design file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) openDesignFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
