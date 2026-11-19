import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

if (import.meta.env.DEV) {
  // Console access for poking at state and replaying synthetic hands.
  Promise.all([
    import('./store/viewerStore'),
    import('./store/handStore'),
    import('./actions/viewerActions'),
    import('./vision/handPipeline'),
    import('./scene/picking'),
  ]).then(([viewer, hands, actions, pipeline, picking]) => {
    window.holocad = {
      viewerStore: viewer.useViewerStore,
      handStore: hands.useHandStore,
      actions,
      processResult: pipeline.processResult,
      pickPartAt: picking.pickPartAt,
    };
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
