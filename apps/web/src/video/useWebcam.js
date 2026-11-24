import { useEffect, useState } from 'react';
import { preset } from '../quality';
import { setCameras } from '../actions/viewerActions';
import { useViewerStore } from '../store/viewerStore';

function describeCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera permission denied',
        detail: 'Allow camera access for this site (click the camera icon in the address bar), then reload.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        title: 'No camera found',
        detail: 'Connect a webcam, or pick another camera from the CAMERA menu.',
      };
    case 'NotReadableError':
      return {
        title: 'Camera is busy',
        detail: 'Another app (Zoom, Teams, Photo Booth…) is probably using it. Close it and reload.',
      };
    case 'Unsupported':
      return {
        title: 'Camera not available',
        detail: 'This browser blocks the camera here. Use Chrome or Edge on http://localhost or an https:// URL.',
      };
    default:
      return { title: 'Could not start the camera', detail: error?.message ?? String(error) };
  }
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function refreshCameraList(activeId) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  setCameras(cameras, activeId);
}

export function useWebcam(videoRef, deviceId) {
  const [state, setState] = useState({ status: 'starting', error: null });

  useEffect(() => {
    let stream = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ status: 'error', error: describeCameraError({ name: 'Unsupported' }) });
        return;
      }
      setState({ status: 'starting', error: null });
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: preset.camera.width },
            height: { ideal: preset.camera.height },
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
          },
        });
        if (cancelled) return stopStream(stream);

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch((err) => {
          if (err.name !== 'AbortError') throw err;
        });

        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
        await refreshCameraList(activeId);
        if (!cancelled) setState({ status: 'ready', error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', error: describeCameraError(err) });
      }
    }

    start();
    return () => {
      cancelled = true;
      stopStream(stream);
    };
  }, [videoRef, deviceId]);

  useEffect(() => {
    const onChange = () => refreshCameraList(useViewerStore.getState().activeCameraId).catch(() => {});
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, []);

  return state;
}
