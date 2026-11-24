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
    import('./store/specStore'),
    import('./models/partFaces'),
    import('./scene/handleQueries'),
    import('./store/assemblyStore'),
    import('./actions/assemblyActions'),
    import('./scene/assemblyQueries'),
    import('./vision/gestureEngine'),
    import('./store/uiStore'),
  ]).then(
    ([
      viewer,
      hands,
      actions,
      pipeline,
      picking,
      libraryStore,
      library,
      sceneQueries,
      measure,
      specs,
      faces,
      handles,
      assemblyStore,
      assembly,
      assemblyQueries,
      gestures,
      ui,
    ]) => {
      window.holocad = {
        viewerStore: viewer.useViewerStore,
        handStore: hands.useHandStore,
        libraryStore: libraryStore.useLibraryStore,
        actions,
        library,
        processResult: pipeline.processResult,
        createGestureEngine: gestures.createGestureEngine, // feed it made-up hands
        uiStore: ui.useUiStore,
        pickPartAt: picking.pickPartAt,
        snapAt: sceneQueries.snapAt,
        pointAt: sceneQueries.pointAt,
        handleAt: handles.handleAt, // design handles: which one is under a pixel
        assemblyStore: assemblyStore.useAssemblyStore,
        assembly,
        componentAt: assemblyQueries.componentAt, // ASSEMBLE: which part / face is under a pixel
        faceAt: assemblyQueries.faceAt,
        measure,
        specStore: specs.useSpecStore,
        // Which CAD face/edge is under a pixel, as the inspector sees it.
        inspectAt: (x, y) =>
          sceneQueries.inspectAt(x, y, (i) => faces.productForSpec(specs.useSpecStore.getState().faces, i)),
      };
    },
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
