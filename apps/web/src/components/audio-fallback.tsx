/**
 * The designed audio-unavailable fallback (GAP-037, E23 quality spec §8): a calm note pointing
 * at the transcript — never a repeated raw error string. Takes no error text, so a raw error
 * cannot leak through even by accident.
 */
export function AudioFallback() {
  return (
    <div className="audio-fallback" role="status">
      <p className="audio-fallback__title">Audio unavailable</p>
      <p className="audio-fallback__body">
        The audio for this segment couldn&apos;t load — the transcript is below, so you can keep
        going.
      </p>
    </div>
  );
}
