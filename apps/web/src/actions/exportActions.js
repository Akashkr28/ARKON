import { findModelEntry } from '../models/catalog';
import { bomCsv, buildBom, exportFileName } from '../models/bom';
import { takeSnapshot } from '../scene/viewSnapshot';
import { useSpecStore } from '../store/specStore';
import { useViewerStore } from '../store/viewerStore';
import { formatSize } from '../units';

// Bill of materials for the open model, in the user's length unit.
export function currentBom() {
  const viewer = useViewerStore.getState();
  const { specs, materialPicks } = useSpecStore.getState();
  const bom = buildBom({ parts: Object.values(viewer.parts), specs, picks: materialPicks, unit: viewer.lengthUnit });
  const entry = findModelEntry(viewer.modelId);
  return { bom, modelLabel: entry?.label ?? 'Model', modelSize: viewer.modelSize, unit: viewer.lengthUnit };
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBomCsv() {
  const { bom, modelLabel } = currentBom();
  const fileName = exportFileName(modelLabel, 'BOM.csv');
  download(new Blob([bomCsv(bom)], { type: 'text/csv;charset=utf-8' }), fileName);
  return fileName;
}

const fixed = (value, digits) => (value == null ? '-' : Number(value.toFixed(digits)).toLocaleString('en-US'));
const massText = (kg) => (kg == null ? '-' : kg < 1 ? `${fixed(kg * 1000, 1)} g` : `${fixed(kg, 3)} kg`);

// A4 landscape: summary with a picture of the current view, then the full BOM table.
// jsPDF loads only when a report is made.
export async function exportPdfReport() {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const { bom, modelLabel, modelSize, unit } = currentBom();
  const u = bom.unitLabel;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const created = new Date();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`${modelLabel}: bill of materials`, 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`HoloCAD report · ${created.toLocaleString('en-GB')} · lengths in ${u}, masses in kg`, 14, 22);
  doc.setTextColor(0);

  // Picture of the view, as the user left it (exploded, sectioned, isolated…).
  const shot = takeSnapshot();
  let summaryX = 14;
  if (shot) {
    const width = 150;
    const height = Math.min(95, (width * shot.height) / shot.width);
    doc.addImage(shot.dataUrl, 'JPEG', 14, 27, (height * shot.width) / shot.height, height);
    summaryX = 14 + (height * shot.width) / shot.height + 8;
  }

  const { totals } = bom;
  const byMaterial = new Map();
  for (const r of bom.rows) {
    if (r.totalMassKg == null) continue;
    byMaterial.set(r.material, (byMaterial.get(r.material) ?? 0) + r.totalMassKg);
  }
  const summary = [
    ['Parts', `${totals.instances} (${totals.uniqueParts} different)`],
    ['Total mass', totals.massKg == null ? 'unknown (no materials)' : massText(totals.massKg)],
    ...(totals.partsWithoutMass ? [['Without mass', `${totals.partsWithoutMass} parts (no material)`]] : []),
    ['Overall size', modelSize ? formatSize(modelSize, unit) : '-'],
    ...[...byMaterial.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, kg], i) => [i === 0 ? 'By material' : '', `${name}: ${massText(kg)}`]),
  ];
  autoTable(doc, {
    startY: 27,
    margin: { left: summaryX, right: 14 },
    body: summary,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 28 } },
  });
  if (!totals.withSpecs) {
    doc.setFontSize(8);
    doc.setTextColor(150, 60, 0);
    doc.text('No CAD data (GLB upload): sizes, masses and features need the STEP file.', summaryX, 120);
    doc.setTextColor(0);
  }

  autoTable(doc, {
    startY: 128,
    head: [
      [
        '#',
        'Part no.',
        'Part',
        'Qty',
        'Material',
        'Unit mass',
        'Total mass',
        `Size L×W×H (${u})`,
        `Volume (${u}³)`,
        'Features',
        'Used in',
      ],
    ],
    body: bom.rows.map((r) => [
      r.item,
      r.partNumber,
      r.description ? `${r.name}\n${r.description}` : r.name,
      r.quantity,
      r.material || '-',
      massText(r.unitMassKg),
      massText(r.totalMassKg),
      r.size ? r.size.map((v) => fixed(v, unit === 'in' ? 2 : 1)).join(' × ') : '-',
      r.volume == null ? '-' : fixed(r.volume, unit === 'in' ? 2 : 0),
      r.features.replace(/ \([^)]*\)$/, ''),
      r.usedIn.join(', '),
    ]),
    styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
    headStyles: { fillColor: [3, 60, 80] },
    columnStyles: {
      0: { cellWidth: 8 },
      3: { cellWidth: 9, halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    didDrawPage: () => {
      doc.setFontSize(7);
      doc.setTextColor(120);
      doc.text(
        'Masses are CAD volume × material density. Picked materials (spec sheet) are included.',
        14,
        doc.internal.pageSize.getHeight() - 8,
      );
      doc.text(`Page ${doc.getNumberOfPages()}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, {
        align: 'right',
      });
      doc.setTextColor(0);
    },
  });

  const fileName = exportFileName(modelLabel, 'report.pdf');
  doc.save(fileName);
  return fileName;
}
