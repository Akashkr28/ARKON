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
    import('./store/libraryStore'),
    import('./actions/libraryActions'),
    import('./scene/sceneQueries'),
    import('./actions/measureActions'),
  ]).then(([viewer, hands, actions, pipeline, picking, libraryStore, library, sceneQueries, measure]) => {
    window.holocad = {
      viewerStore: viewer.useViewerStore,
      handStore: hands.useHandStore,
      libraryStore: libraryStore.useLibraryStore,
      actions,
      library,
      processResult: pipeline.processResult,
      pickPartAt: picking.pickPartAt,
      snapAt: sceneQueries.snapAt,
      measure,
    };
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
