'use client';

/**
 * Confidence capture (GAP-037, E23 quality spec §3): a single-tap segmented control for
 * low/medium/high — not three radios in a form. Tapping a segment selects it immediately; the
 * selection rides along with the attempt when it is submitted.
 *
 * The ARIA radio-group pattern (role="radiogroup" over role="radio" buttons) keeps it fully
 * keyboard-operable: Tab lands on the group, arrow keys move the selection, Space/Enter pick.
 */

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export function ConfidenceControl({
  value,
  onChange,
}: {
  /** The currently selected level; `undefined` means none picked yet. */
  readonly value?: ConfidenceLevel;
  readonly onChange?: (level: ConfidenceLevel) => void;
}) {
  const select = (level: ConfidenceLevel) => {
    if (value !== level) onChange?.(level);
  };

  const move = (level: ConfidenceLevel, delta: -1 | 1) => {
    const index = CONFIDENCE_LEVELS.indexOf(level);
    const next =
      CONFIDENCE_LEVELS[(index + delta + CONFIDENCE_LEVELS.length) % CONFIDENCE_LEVELS.length];
    if (next) onChange?.(next);
  };

  const focus = (event: React.KeyboardEvent<HTMLButtonElement>, level: ConfidenceLevel) => {
    // Arrow keys move the selection (and focus follows the ARIA pattern); Home/End jump.
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(level, 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(level, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const first = CONFIDENCE_LEVELS[0];
      if (first) onChange?.(first);
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];
      if (last) onChange?.(last);
    }
  };

  return (
    <div className="confidence" role="radiogroup" aria-label="How sure are you?">
      {CONFIDENCE_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          className="confidence__option"
          onClick={() => select(level)}
          onKeyDown={(event) => focus(event, level)}
        >
          {level}
        </button>
      ))}
    </div>
  );
}
