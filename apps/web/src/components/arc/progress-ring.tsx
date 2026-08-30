/**
 * The progress ring from the prototype: a conic gradient driven by a --value custom property,
 * with an accessible text label inside.
 */
export function ProgressRing({
  percent,
  label,
  size = 'default',
}: {
  percent: number;
  label: string;
  size?: 'default' | 'large' | 'hero';
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className={`arc-ring${size === 'large' ? ' arc-ring-large' : ''}${size === 'hero' ? ' arc-ring-hero' : ''}`}
      style={{ ['--value' as string]: clamped }}
      role="img"
      aria-label={`${label} progress: ${clamped} percent`}
    >
      <span>{clamped}%</span>
    </div>
  );
}
