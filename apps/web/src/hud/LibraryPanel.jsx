import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../store/libraryStore';
import { useViewerStore } from '../store/viewerStore';
import * as library from '../actions/libraryActions';
import { loadModel } from '../actions/viewerActions';
import { LIBRARY, MODELS } from '../config';

const STATUS_TEXT = {
  queued: 'QUEUED',
  converting: 'CONVERTING',
  ready: 'READY',
  failed: 'FAILED',
};

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ModelRow({ model, active }) {
  const armed = useLibraryStore((s) => s.pendingDeleteId === model.id);
  const ready = model.status === 'ready';
  const pending = model.status === 'queued' || model.status === 'converting';
  const details = [
    model.sourceFormat.toUpperCase(),
    ready && model.partCount !== null ? `${model.partCount} PARTS` : null,
    formatBytes(model.glbBytes ?? model.sourceBytes),
  ].filter(Boolean);

  return (
    <li className={`library-row status-${model.status}${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className="library-open"
        disabled={!ready}
        onClick={() => loadModel(model.id)}
        title={ready ? `Open ${model.name}` : undefined}
      >
        <span className="library-name">{model.name}</span>
        <span className="library-meta">
          <span className={`library-badge${pending ? ' is-busy' : ''}`}>{STATUS_TEXT[model.status]}</span>
          {details.join(' · ')}
        </span>
      </button>
      {model.status === 'failed' && (
        <div className="library-error">
          {model.error}
          {model.sourceFormat === 'step' && (
            <button type="button" onClick={() => library.retryConversion(model.id)}>
              RETRY
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className={`library-delete${armed ? ' is-armed' : ''}`}
        onClick={() => library.deleteLibraryModel(model.id)}
        aria-label={armed ? `Confirm delete ${model.name}` : `Delete ${model.name}`}
        title={armed ? 'Click again to delete' : 'Delete'}
      >
        {armed ? 'DELETE?' : '✕'}
      </button>
    </li>
  );
}

function UploadRow({ upload }) {
  return (
    <li className={`library-row upload-row${upload.error ? ' status-failed' : ''}`}>
      <div className="library-open">
        <span className="library-name">{upload.filename}</span>
        {upload.error ? (
          <span className="library-error">{upload.error}</span>
        ) : (
          <span className="library-progress">
            <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </span>
        )}
      </div>
      {upload.error && (
        <button type="button" className="library-delete" onClick={() => library.dismissUpload(upload.key)} aria-label="Dismiss">
          ✕
        </button>
      )}
    </li>
  );
}

export default function LibraryPanel() {
  const fileInput = useRef(null);
  const { apiStatus, converterStatus, models, uploads, quality } = useLibraryStore(
    useShallow((s) => ({
      apiStatus: s.apiStatus,
      converterStatus: s.converterStatus,
      models: s.models,
      uploads: s.uploads,
      quality: s.quality,
    })),
  );
  const waitingOnConverter = converterStatus === 'down' && models.some((m) => m.status === 'queued');
  const activeId = useViewerStore((s) => s.modelId);
  const online = apiStatus === 'online';

  return (
    <div className="hud-panel hud-library">
      <div className="hud-panel-title library-title">
        <span>LIBRARY</span>
        <span className={`library-api api-${apiStatus}`}>{online ? 'API ONLINE' : apiStatus === 'offline' ? 'API OFFLINE' : '…'}</span>
      </div>

      <div className="library-upload">
        <button type="button" className="hud-toggle" disabled={!online} onClick={() => fileInput.current.click()} title="Upload a .step, .stp or .glb file (or drop it on the window)">
          <span>+ UPLOAD</span>
        </button>
        <select
          value={quality}
          onChange={(e) => library.setUploadQuality(e.target.value)}
          disabled={!online}
          aria-label="Mesh quality for STEP conversion"
          title="Mesh quality for STEP conversion"
        >
          <option value="draft">DRAFT</option>
          <option value="standard">STANDARD</option>
          <option value="fine">FINE</option>
        </select>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={LIBRARY.acceptedExtensions.join(',')}
          onChange={(e) => {
            for (const file of e.target.files) library.uploadFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {!online && apiStatus === 'offline' && (
        <div className="library-offline">
          Uploads need the API. Run <code>npm run dev</code>, and <code>npm run db:start</code> for the database.
          <button type="button" onClick={library.refreshLibrary}>RETRY</button>
        </div>
      )}
      {online && waitingOnConverter && (
        <div className="library-offline">
          The STEP converter isn&apos;t running, so queued models are waiting. Start it with{' '}
          <code>npm run dev</code> (or <code>npm run dev:converter</code>); they&apos;ll convert automatically.
        </div>
      )}

      <ul className="library-list">
        {uploads.map((upload) => (
          <UploadRow key={upload.key} upload={upload} />
        ))}
        {models.map((model) => (
          <ModelRow key={model.id} model={model} active={model.id === activeId} />
        ))}
      </ul>

      <div className="library-section">SAMPLES</div>
      <ul className="library-list">
        {MODELS.map((sample) => (
          <li key={sample.id} className={`library-row${sample.id === activeId ? ' is-active' : ''}`}>
            <button type="button" className="library-open" onClick={() => loadModel(sample.id)}>
              <span className="library-name">{sample.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
