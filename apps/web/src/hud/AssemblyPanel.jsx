import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MATE_TYPES, mateOf, toCadMm } from '../cad/assembly';
import { MODELS } from '../config';
import {
  addDesignFilePart,
  addDesignPart,
  addModelPart,
  closeAssembly,
  currentAssemblyBom,
  duplicateComponent,
  exportAssemblyBomCsv,
  exportAssemblyGlb,
  exportAssemblyStep,
  flipMate,
  newAssembly,
  openAssemblyFile,
  refitAssembly,
  removeComponent,
  removeMate,
  renameAssembly,
  renameComponent,
  saveAssemblyFile,
  saveAssemblyToLibrary,
  selectComponent,
  setComponentAppearance,
  setComponentPositionMm,
  setMateValue,
  setTool,
  turnComponent,
} from '../actions/assemblyActions';
import { useAssemblyStore } from '../store/assemblyStore';
import { useLibraryStore } from '../store/libraryStore';
import { useViewerStore } from '../store/viewerStore';
import { appearanceOf } from '../models/assemblyBom';
import { describeAppearance } from '../cad/appearance';
import { formatMass, formatSpecLength } from '../units';
import AppearanceEditor from './AppearanceEditor';

// A number field that keeps what you type until it's a number (no snapping mid-edit).
function NumberField({ label, value, unit = 'mm', onCommit }) {
  const shown = String(Number(value.toFixed(3)));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  return (
    <label className="design-field">
      <span>{label}</span>
      <span className="design-input">
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          value={text}
          aria-label={label}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(shown);
          }}
          onChange={(e) => {
            setText(e.target.value);
            const number = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(number)) onCommit(number);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <em>{unit}</em>
      </span>
    </label>
  );
}

const TOOL_HINTS = {
  contact: 'FACE TO FACE: click a flat face on the part to move, then a flat face on the part it sits on.',
  axis: 'ON AXIS: click a round face on the part to move (a pin), then a round face to line it up with (a hole).',
};

function AddPart() {
  const models = useLibraryStore((s) => s.models);
  const library = models.filter((m) => m.status === 'ready');
  const fileInput = useRef(null);
  return (
    <>
      <div className="design-actions">
        <button type="button" onClick={() => addDesignPart()} title="A copy of the part in DESIGN as it is now">
          + THIS DESIGN
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} title="Add a saved .holocad.json design">
          + DESIGN FILE…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Add design file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addDesignFilePart(file);
            e.target.value = '';
          }}
        />
      </div>
      <div className="design-add">
        <select value="" onChange={(e) => e.target.value && addModelPart(e.target.value)} aria-label="Add a model">
          <option value="">+ Add a model (sample or upload)…</option>
          <optgroup label="Samples">
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
          {library.length > 0 && (
            <optgroup label="Library">
              {library.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </>
  );
}

function PartRow({ component, mate, targetName, status, selected }) {
  const text =
    status?.status === 'loading'
      ? 'loading…'
      : status?.status === 'error'
        ? status.error
        : mate
          ? `${MATE_TYPES[mate.type].label.toLowerCase()} on ${targetName}`
          : 'free: drag to move';
  const look = describeAppearance(appearanceOf(component));
  return (
    <div
      className={`design-feature${selected ? ' is-selected' : ''}${status?.status === 'error' ? ' has-error' : ''}`}
      role="listitem"
      onClick={() => selectComponent(component.id)}
    >
      <div className="design-feature-text">
        <strong>{component.name}</strong>
        <span className={status?.status === 'error' ? 'design-error' : undefined}>{text}</span>
        {status?.status === 'ready' && <span className="spec-muted">{look}</span>}
      </div>
      <div className="design-feature-buttons" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => duplicateComponent(component.id)} title="Add another one" aria-label={`Duplicate ${component.name}`}>
          ⧉
        </button>
        <button type="button" onClick={() => removeComponent(component.id)} title="Delete" aria-label={`Delete ${component.name}`}>
          ✕
        </button>
      </div>
    </div>
  );
}

function TurnButtons({ id, mated }) {
  if (mated) {
    return (
      <div className="design-actions">
        <button type="button" onClick={() => turnComponent(id, null, 90)} title="Turn a quarter about the mate">
          ⟲ 90°
        </button>
        <button type="button" onClick={() => turnComponent(id, null, 15)} title="Turn 15° about the mate">
          ⟲ 15°
        </button>
      </div>
    );
  }
  return (
    <div className="design-actions">
      {['x', 'y', 'z'].map((axis) => (
        <button key={axis} type="button" onClick={() => turnComponent(id, axis, 90)} title={`Turn a quarter about ${axis.toUpperCase()}`}>
          ⟲ {axis.toUpperCase()} 90°
        </button>
      ))}
    </div>
  );
}

function SelectedPart({ component, mate, targetName, placement }) {
  const [x, y, z] = toCadMm(placement.position);
  return (
    <div className="design-editor">
      <label className="design-field">
        <span>Name</span>
        <input
          className="design-name"
          value={component.name}
          aria-label="Part name"
          onChange={(e) => renameComponent(component.id, e.target.value)}
        />
      </label>
      {mate ? (
        <>
          <div className="spec-muted">
            {MATE_TYPES[mate.type].label}: {mate.moving.label.split(' · ').at(-1)} on {targetName}’s {mate.target.label.split(' · ').at(-1)}.
            Drag it to slide.
          </div>
          {mate.type === 'contact' ? (
            <>
              <NumberField label="Slide across" value={mate.slide[0]} onCommit={(v) => setMateValue(mate.id, 'slideU', v)} />
              <NumberField label="Slide along" value={mate.slide[1]} onCommit={(v) => setMateValue(mate.id, 'slideV', v)} />
              <NumberField label="Gap" value={mate.gap} onCommit={(v) => setMateValue(mate.id, 'gap', v)} />
            </>
          ) : (
            <NumberField label="Slide along axis" value={mate.slide} onCommit={(v) => setMateValue(mate.id, 'slide', v)} />
          )}
          <NumberField label="Angle" value={mate.angle} unit="°" onCommit={(v) => setMateValue(mate.id, 'angle', v)} />
          <TurnButtons id={component.id} mated />
          <div className="design-actions">
            <button type="button" onClick={() => flipMate(mate.id)} title="Turn it over (face to face ⇄ facing the same way)">
              FLIP
            </button>
            <button type="button" onClick={() => removeMate(mate.id)} title="Detach it; it stays where it is">
              UNMATE
            </button>
          </div>
        </>
      ) : (
        <>
          <NumberField label="X" value={x} onCommit={(v) => setComponentPositionMm(component.id, [v, y, z])} />
          <NumberField label="Y" value={y} onCommit={(v) => setComponentPositionMm(component.id, [x, v, z])} />
          <NumberField label="Z (up)" value={z} onCommit={(v) => setComponentPositionMm(component.id, [x, y, v])} />
          <TurnButtons id={component.id} />
        </>
      )}
    </div>
  );
}

function AssemblyFiles() {
  const input = useRef(null);
  return (
    <div className="design-actions">
      <button type="button" onClick={saveAssemblyFile} title="Download the assembly (.holocad-assembly.json)">
        SAVE ASSEMBLY
      </button>
      <button type="button" onClick={() => input.current?.click()} title="Open a .holocad-assembly.json">
        OPEN ASSEMBLY
      </button>
      <button type="button" onClick={refitAssembly} title="Re-centre and fit everything on screen">
        RE-FIT
      </button>
      <button type="button" onClick={newAssembly} title="Start an empty assembly">
        NEW
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Open assembly file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) openAssemblyFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// Totals for the whole assembly; the BOM CSV has them per part.
function AssemblyProperties({ content }) {
  const unit = useViewerStore((s) => s.lengthUnit);
  // Re-rendered when parts load (their masses arrive) or change (materials).
  const bom = currentAssemblyBom();
  const loading = Object.values(content).some((c) => c.status === 'loading');
  return (
    <dl className="spec-grid" aria-label="Assembly properties">
      <dt>PARTS</dt>
      <dd>
        {bom.totals.parts} ({bom.totals.uniqueParts} different)
      </dd>
      <dt>MASS</dt>
      <dd>
        <span className="spec-strong">{bom.totals.massKg == null ? '—' : formatMass(bom.totals.massKg, unit)}</span>
        {bom.totals.partsWithoutMass > 0 && <span className="spec-muted"> · {bom.totals.partsWithoutMass} without a known mass</span>}
        {loading && <span className="spec-muted"> · loading…</span>}
      </dd>
      {bom.rows.map((row) => (
        <BomLine key={row.item} row={row} unit={unit} />
      ))}
    </dl>
  );
}

function BomLine({ row, unit }) {
  const L = (mm) => formatSpecLength(mm, unit);
  return (
    <>
      <dt>
        {row.quantity}× {row.name.toUpperCase()}
      </dt>
      <dd>
        {row.totalMassKg == null ? row.material || '—' : `${formatMass(row.totalMassKg, unit)} · ${row.material}`}
        {row.sizeMm && <span className="spec-muted"> · {row.sizeMm.map(L).join(' × ')}</span>}
      </dd>
    </>
  );
}

// The ASSEMBLE workspace: parts from DESIGN, samples and uploads, put together with mates.
export default function AssemblyPanel() {
  const a = useAssemblyStore(
    useShallow((s) => ({
      name: s.name,
      components: s.components,
      mates: s.mates,
      placements: s.placements,
      content: s.content,
      selectedComponentId: s.selectedComponentId,
      tool: s.tool,
      pick: s.pick,
      hoverFace: s.hoverFace,
      message: s.message,
    })),
  );
  const saving = useAssemblyStore((s) => s.saving);
  const nameOf = (id) => a.components.find((c) => c.id === id)?.name ?? '?';
  const selected = a.components.find((c) => c.id === a.selectedComponentId) ?? null;
  const selectedMate = selected ? mateOf(a.mates, selected.id) : null;

  return (
    <div className="hud-panel hud-design" aria-label="Assembly">
      <div className="design-header">
        <input className="design-name" value={a.name} onChange={(e) => renameAssembly(e.target.value)} aria-label="Assembly name" />
        <button type="button" onClick={closeAssembly} title="Back to the model viewer">
          ◂ VIEWER
        </button>
      </div>
      <div className="design-status" role="status">
        {a.tool
          ? a.hoverFace
            ? `${TOOL_HINTS[a.tool].split(':')[0]}: ${a.hoverFace.label}`
            : TOOL_HINTS[a.tool]
          : a.components.length
            ? 'Drag a part to move it. Mate two parts to snap them together.'
            : 'Add parts: the one you designed, a sample, or a model from your library.'}
      </div>

      <div className="spec-section">ADD PART</div>
      <AddPart />

      <div className="spec-section">PARTS</div>
      {a.components.length === 0 && <div className="spec-muted">No parts yet.</div>}
      <div className="design-features" role="list" aria-label="Parts">
        {a.components.map((component) => {
          const mate = mateOf(a.mates, component.id);
          return (
            <PartRow
              key={component.id}
              component={component}
              mate={mate}
              targetName={mate ? nameOf(mate.target.componentId) : null}
              status={a.content[component.id]}
              selected={component.id === a.selectedComponentId}
            />
          );
        })}
      </div>

      {selected && a.placements[selected.id] && (
        <>
          <div className="spec-section">{selected.name.toUpperCase()}</div>
          <SelectedPart
            component={selected}
            mate={selectedMate}
            targetName={selectedMate ? nameOf(selectedMate.target.componentId) : null}
            placement={a.placements[selected.id]}
          />
          <div className="spec-section">LOOK</div>
          <AppearanceEditor
            appearance={appearanceOf(selected)}
            paint={selected.source.kind === 'model'}
            onChange={(patch) => setComponentAppearance(selected.id, patch)}
          />
        </>
      )}

      <div className="spec-section">MATE</div>
      <div className="design-actions" role="group" aria-label="Mate tools">
        {Object.entries(MATE_TYPES).map(([type, spec]) => (
          <button
            key={type}
            type="button"
            className={a.tool === type ? 'is-active' : undefined}
            aria-pressed={a.tool === type}
            disabled={a.components.length < 2}
            onClick={() => setTool(a.tool === type ? null : type)}
            title={spec.hint}
          >
            {spec.label.toUpperCase()}
          </button>
        ))}
        {a.tool && (
          <button type="button" onClick={() => setTool(null)} title="Stop picking (Esc)">
            CANCEL
          </button>
        )}
      </div>
      {a.tool && a.pick && <div className="spec-muted">Moving: {a.pick.label}</div>}
      {a.mates.length > 0 && (
        <div className="design-features" role="list" aria-label="Mates">
          {a.mates.map((mate) => (
            <div key={mate.id} className="design-feature" role="listitem" onClick={() => selectComponent(mate.moving.componentId)}>
              <div className="design-feature-text">
                <strong>
                  {nameOf(mate.moving.componentId)} → {nameOf(mate.target.componentId)}
                </strong>
                <span>{MATE_TYPES[mate.type].label}</span>
              </div>
              <div className="design-feature-buttons" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => removeMate(mate.id)} title="Unmate" aria-label={`Unmate ${nameOf(mate.moving.componentId)}`}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {a.components.length > 0 && (
        <>
          <div className="spec-section">PROPERTIES</div>
          <AssemblyProperties content={a.content} />
        </>
      )}

      <div className="spec-section">EXPORT</div>
      <div className="design-actions">
        <button type="button" onClick={exportAssemblyGlb} disabled={!a.components.length || saving} title="Everything, placed and coloured (.glb)">
          {saving === 'glb' ? 'GLB…' : 'EXPORT GLB'}
        </button>
        <button
          type="button"
          onClick={exportAssemblyStep}
          disabled={!a.components.some((c) => c.source.kind === 'design') || saving}
          title="Designed parts as a STEP assembly, named, coloured and placed (any CAD program)"
        >
          {saving === 'step' ? 'STEP…' : 'EXPORT STEP'}
        </button>
        <button type="button" onClick={exportAssemblyBomCsv} disabled={!a.components.length} title="Bill of materials (.csv)">
          BOM CSV
        </button>
        <button type="button" onClick={saveAssemblyToLibrary} disabled={!a.components.length || saving} title="Open it in the viewer like any model">
          {saving === 'library' ? 'SAVING…' : 'SAVE TO LIBRARY'}
        </button>
      </div>

      <div className="spec-section">FILE</div>
      <AssemblyFiles />
      {a.message && (
        <div className="design-message" role="status" aria-label="Assembly message">
          {a.message}
        </div>
      )}
    </div>
  );
}
