import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MATERIAL_LIBRARY } from '../config';
import { loadFaces, loadSpecs, pinInspected, pickMaterial } from '../actions/specActions';
import { setLengthUnit } from '../actions/viewerActions';
import { exportBomCsv, exportPdfReport } from '../actions/exportActions';
import { useState } from 'react';
import { findModelEntry } from '../models/catalog';
import { effectiveMaterial, massKg, productKey, selectionTotals } from '../models/partSpecs';
import { describeItem, productForSpec } from '../models/partFaces';
import { useLibraryStore } from '../store/libraryStore';
import { useUiStore } from '../store/uiStore';
import { useSpecStore } from '../store/specStore';
import { useViewerStore } from '../store/viewerStore';
import { formatArea, formatLength, formatMass, formatSize, formatSpecLength, formatVolume } from '../units';

// Loads the open model's specs. Keyed on the model's URL, so a re-converted upload
// (new URL) brings fresh specs too.
export function SpecsLoader() {
  const modelId = useViewerStore((s) => s.modelId);
  const libraryModels = useLibraryStore((s) => s.models);
  const url = findModelEntry(modelId, libraryModels)?.url;
  useEffect(() => {
    if (url) loadSpecs(modelId);
  }, [modelId, url]);
  // Face/edge data only once the spec sheet is open (it's what uses it).
  const specsOpen = useUiStore((s) => s.hudTab === 'specs');
  const specsLoaded = useSpecStore((s) => s.status !== 'loading' && s.modelId === modelId);
  useEffect(() => {
    if (url && specsOpen && specsLoaded) loadFaces(modelId);
  }, [modelId, url, specsOpen, specsLoaded]);
  return null;
}

const SURFACE_LABELS = {
  plane: 'flat',
  cylinder: 'cylindrical',
  cone: 'conical',
  sphere: 'spherical',
  torus: 'toroidal',
  freeform: 'freeform',
  revolved: 'revolved',
  extruded: 'extruded',
  offset: 'offset',
  other: 'other',
};

function Row({ label, children, title }) {
  return (
    <>
      <dt title={title}>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function MaterialPicker({ spec, keyName, picked }) {
  const fromFile = spec.material?.name || spec.material?.densityKgM3;
  return (
    <select
      className="spec-material"
      value={picked?.id ?? ''}
      onChange={(e) => pickMaterial(keyName, e.target.value || null)}
      aria-label="Material"
    >
      <option value="">
        {fromFile ? `From CAD: ${spec.material.name ?? 'unnamed'}` : 'No material in the CAD file'}
      </option>
      {MATERIAL_LIBRARY.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} · {m.density.toLocaleString('en-US')} kg/m³
        </option>
      ))}
    </select>
  );
}

function FeatureList({ items, describe }) {
  if (!items?.length) return <span className="spec-muted">none</span>;
  return (
    <ul className="spec-features">
      {items.map((item) => (
        <li key={describe(item)}>{describe(item)}</li>
      ))}
    </ul>
  );
}

function PartSheet({ part, spec, unit, picks }) {
  const key = productKey(spec, part.name);
  const material = effectiveMaterial(spec, picks[key]);
  const mass = massKg(spec.volumeMm3, material?.density);
  const [length, width, height] = spec.overallSizeMm ?? [];
  const L = (mm) => formatSpecLength(mm, unit);
  const surfaces = Object.entries(spec.surfaces ?? {})
    .map(([type, n]) => `${n} ${SURFACE_LABELS[type] ?? type}`)
    .join(' · ');

  return (
    <>
      <div className="spec-title">{part.name}</div>
      {part.path?.length > 0 && <div className="part-info-path">{part.path.map((s) => s.name).join(' › ')}</div>}
      <dl className="spec-grid">
        {spec.partNumber && <Row label="PART NO.">{spec.partNumber}</Row>}
        {spec.productName && spec.productName !== part.name && <Row label="PART">{spec.productName}</Row>}
        {spec.description && <Row label="DESCRIPTION">{spec.description}</Row>}
      </dl>

      <div className="spec-section">MATERIAL & MASS</div>
      <MaterialPicker spec={spec} keyName={key} picked={picks[key]} />
      <dl className="spec-grid">
        <Row label="DENSITY">{material?.density ? `${material.density.toLocaleString('en-US')} kg/m³` : '—'}</Row>
        <Row label="MASS">
          <span className="spec-strong">{formatMass(mass, unit)}</span>
          {!mass && <span className="spec-muted"> · pick a material</span>}
        </Row>
      </dl>

      <div className="spec-section">GEOMETRY</div>
      <dl className="spec-grid">
        <Row label="SIZE" title="Tightest box in the part's own orientation: length × width × height">
          {L(length)} × {L(width)} × {L(height)}
        </Row>
        <Row label="VOLUME">{formatVolume(spec.volumeMm3, unit)}</Row>
        <Row label="AREA" title="Total surface area">
          {formatArea(spec.surfaceAreaMm2, unit)}
        </Row>
        <Row label="CENTRE" title="Centre of mass, in the viewer's axes (Y up)">
          {spec.centreOfMassM
            ? spec.centreOfMassM.map((v, i) => `${'XYZ'[i]} ${formatLength(v, unit, { precise: true })}`).join(' · ')
            : '—'}
        </Row>
        <Row label="TOPOLOGY">
          {spec.solids} solid{spec.solids === 1 ? '' : 's'} · {spec.faces} faces · {spec.edges} edges
        </Row>
        <Row label="FACES">{surfaces || '—'}</Row>
      </dl>

      <div className="spec-section">FEATURES</div>
      <dl className="spec-grid">
        <Row label="HOLES">
          <FeatureList
            items={spec.features?.holes}
            describe={(h) => `${h.count} × Ø${L(h.diameter)}, ${L(h.depth)} deep`}
          />
        </Row>
        <Row label="OUTER Ø" title="Shafts, pins, bosses and round outer edges">
          <FeatureList
            items={spec.features?.outerDiameters}
            describe={(d) => `${d.count} × Ø${L(d.diameter)}, ${L(d.length)} long`}
          />
        </Row>
        <Row label="FILLETS">
          <FeatureList items={spec.features?.fillets} describe={(f) => `${f.count} × R${L(f.radius)}`} />
        </Row>
      </dl>
      <InspectedSection part={part} unit={unit} />
    </>
  );
}

// The face or edge last clicked on this part, and how to inspect more.
function InspectedSection({ part, unit }) {
  const { facesStatus, faces, pinned } = useSpecStore(
    useShallow((s) => ({ facesStatus: s.facesStatus, faces: s.faces, pinned: s.pinned })),
  );
  const product = productForSpec(faces, part.specIndex);
  const item = pinned?.partId === part.id ? pinned : null;
  const described = describeItem(product, item, unit);
  let hint;
  if (facesStatus === 'loading') hint = 'Loading faces and edges…';
  else if (facesStatus === 'ready' && product) {
    hint = described ? null : 'Hover the model to name each face and edge; click one to keep it here.';
  } else hint = 'No face data for this model (convert the STEP file again to add it).';

  return (
    <>
      <div className="spec-section">
        {item
          ? `PICKED ${item.kind.toUpperCase()} · ${item.index + 1} OF ${item.kind === 'edge' ? product.edges.length : product.faces.length}`
          : 'FACES & EDGES'}
        {item && (
          <button
            type="button"
            className="spec-unpin"
            onClick={() => pinInspected(null)}
            aria-label="Clear picked face or edge"
          >
            ✕
          </button>
        )}
      </div>
      {described ? (
        <div className="spec-inspected" aria-label="Picked face or edge">
          <div className="spec-strong">{described.title}</div>
          {described.details.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : (
        <div className="spec-muted">{hint}</div>
      )}
      {product && (
        <div className="spec-muted">
          {product.faces.length} faces · {product.edges.length} edges
        </div>
      )}
    </>
  );
}

function SelectionSheet({ entries, unit }) {
  const totals = selectionTotals(entries);
  const names = [...new Set(entries.map((e) => e.part.name))];
  return (
    <>
      <div className="spec-title">{totals.count} parts selected</div>
      <dl className="spec-grid">
        <Row label="MASS">
          <span className="spec-strong">{formatMass(totals.massKg, unit)}</span>
          {totals.missingMass > 0 && <span className="spec-muted"> · {totals.missingMass} without a material</span>}
        </Row>
        <Row label="VOLUME">{formatVolume(totals.volumeMm3, unit)}</Row>
      </dl>
      <div className="part-info-list">
        {names.slice(0, 12).join(', ')}
        {names.length > 12 ? ', …' : ''}
      </div>
    </>
  );
}

export default function SpecSheet() {
  const { parts, selectedPartIds, unit } = useViewerStore(
    useShallow((s) => ({ parts: s.parts, selectedPartIds: s.selectedPartIds, unit: s.lengthUnit })),
  );
  const { status, error, specs, picks } = useSpecStore(
    useShallow((s) => ({ status: s.status, error: s.error, specs: s.specs, picks: s.materialPicks })),
  );

  const entries = selectedPartIds
    .map((id) => parts[id])
    .filter(Boolean)
    .map((part) => {
      const spec = specs[part.specIndex] ?? null;
      return { part, spec, material: effectiveMaterial(spec, picks[productKey(spec, part.name)]) };
    });
  const last = entries.at(-1);

  let body;
  if (status === 'loading') body = <div className="spec-empty">Loading part specs…</div>;
  else if (status === 'error') body = <div className="spec-empty library-error">{error}</div>;
  else if (!last)
    body = (
      <div className="spec-empty">Select a part (click it, or pick it in PARTS) to see its full specification.</div>
    );
  else if (entries.length > 1) body = <SelectionSheet entries={entries} unit={unit} />;
  else if (last.spec) body = <PartSheet part={last.part} spec={last.spec} unit={unit} picks={picks} />;
  else {
    body = (
      <>
        <div className="spec-title">{last.part.name}</div>
        <dl className="spec-grid">
          <Row label="SIZE">{formatSize(last.part.size, unit)}</Row>
        </dl>
        <div className="spec-empty">
          No CAD data for this model: GLB files carry only triangles. Upload the STEP file for exact dimensions, mass
          and features.
        </div>
      </>
    );
  }

  return (
    <div className="hud-panel hud-specs" aria-label="Spec sheet">
      <div className="spec-toolbar">
        <span>SPEC SHEET</span>
        <span className="spec-units" role="group" aria-label="Units">
          {['mm', 'in'].map((u) => (
            <button key={u} type="button" className={unit === u ? 'is-active' : ''} onClick={() => setLengthUnit(u)}>
              {u.toUpperCase()}
            </button>
          ))}
        </span>
      </div>
      <ExportBar />
      {body}
    </div>
  );
}

// The whole model's bill of materials, as CSV (spreadsheets, ERP) or a PDF report.
function ExportBar() {
  const partCount = useViewerStore((s) => Object.keys(s.parts).length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pdf = async () => {
    setBusy(true);
    setError(null);
    try {
      await exportPdfReport();
    } catch (e) {
      setError(`Couldn't make the report (${e.message})`);
    } finally {
      setBusy(false);
    }
  };
  if (!partCount) return null;
  return (
    <div className="spec-export" role="group" aria-label="Export bill of materials">
      <span className="spec-muted">BOM · {partCount} parts</span>
      <button type="button" onClick={exportBomCsv} title="Bill of materials as a spreadsheet (CSV)">
        CSV
      </button>
      <button type="button" onClick={pdf} disabled={busy} title="PDF report: view, summary, bill of materials">
        {busy ? 'PDF…' : 'PDF REPORT'}
      </button>
      {error && <span className="library-error">{error}</span>}
    </div>
  );
}
