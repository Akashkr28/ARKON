import { useEffect, useState } from 'react';
import { uploadFile } from '../actions/libraryActions';
import { useLibraryStore } from '../store/libraryStore';

const hasFiles = (event) => event.dataTransfer?.types?.includes('Files');

// Drop STEP/GLB files anywhere on the window to upload them.
export default function DropOverlay() {
  const [dragging, setDragging] = useState(false);
  const online = useLibraryStore((s) => s.apiStatus === 'online');

  useEffect(() => {
    // dragenter/dragleave fire for every child element; count them to know when we've left.
    let depth = 0;
    const onEnter = (event) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (event) => {
      if (hasFiles(event)) event.preventDefault(); // allow dropping
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      for (const file of event.dataTransfer.files) uploadFile(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-overlay-box">
        {online ? 'DROP STEP OR GLB TO UPLOAD' : 'API OFFLINE · UPLOAD WILL FAIL'}
      </div>
    </div>
  );
}
