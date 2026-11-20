import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useViewerStore } from '../store/viewerStore';
import { BLOOM } from '../config';
import { preset } from '../quality';

// Bloom only in hologram mode: the canvas is opaque black there and screen-blended
// over the video, so halos composite cleanly. In original-materials mode the canvas
// is transparent, where bloom halos would be clipped by alpha anyway.
// SAFE quality (bloom 0) skips the effect pass entirely.
export default function Effects() {
  const hologram = useViewerStore((s) => s.materialMode === 'hologram');
  if (!hologram || preset.bloom === 0) return null;

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        luminanceThreshold={BLOOM.luminanceThreshold}
        luminanceSmoothing={BLOOM.luminanceSmoothing}
        intensity={BLOOM.intensity * preset.bloom}
        radius={BLOOM.radius}
        resolutionScale={BLOOM.resolutionScale}
      />
    </EffectComposer>
  );
}
