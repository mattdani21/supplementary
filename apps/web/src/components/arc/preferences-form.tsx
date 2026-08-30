'use client';

/**
 * The Profile preferences (GAP-032): every toggle persists through the API. The dark-mode
 * toggle applies the theme immediately and persists; the spaced-review toggle gates the real
 * due-review queue in Today.
 */

import { useState } from 'react';
import { arcFetch } from './arc-client';

export interface Preferences {
  audioTheory: boolean;
  gentleHints: boolean;
  darkMode: boolean;
  spacedReview: boolean;
}

export function PreferencesForm({
  initial,
  ownerLabel,
}: {
  initial: Preferences;
  ownerLabel: string;
}) {
  const [preferences, setPreferences] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    if ('darkMode' in patch) {
      document.documentElement.dataset.theme = next.darkMode ? 'dark' : 'light';
    }
    setSaving(true);
    setError(null);
    try {
      const body = (await arcFetch('/api/arc/preferences', {
        method: 'PUT',
        body: JSON.stringify(next),
      })) as { preferences: Preferences };
      setPreferences(body.preferences);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const rows: { key: keyof Preferences; title: string; detail: string }[] = [
    {
      key: 'audioTheory',
      title: 'Audio theory',
      detail: 'Make every explanation listenable',
    },
    {
      key: 'gentleHints',
      title: 'Gentle hints',
      detail: 'Reveal a nudge before showing an answer',
    },
    {
      key: 'darkMode',
      title: 'Dark mode',
      detail: 'Use a lower-light learning surface',
    },
    {
      key: 'spacedReview',
      title: 'Spaced review',
      detail: 'Bring cleared gaps back when useful',
    },
  ];

  return (
    <>
      <div className="arc-preference-list">
        {rows.map((row) => (
          <label className="arc-preference-row" key={row.key}>
            <span>
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
            </span>
            <span className="arc-switch">
              <input
                type="checkbox"
                checked={preferences[row.key]}
                onChange={(event) =>
                  update({ [row.key]: event.target.checked } as Partial<Preferences>)
                }
                disabled={saving}
              />
              <span className="arc-switch-track" aria-hidden="true" />
            </span>
          </label>
        ))}
      </div>
      {error && <p className="arc-theory-text">{error}</p>}
      <p className="arc-theory-text" style={{ color: 'var(--ink-faint)', fontSize: 11 }}>
        Preferences are saved to your profile ({ownerLabel}) and apply on every device you sign in
        from.
      </p>
    </>
  );
}
