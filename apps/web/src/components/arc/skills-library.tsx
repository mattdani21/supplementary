'use client';

/**
 * The Skills library: searchable list of real gaps with their real progress, plus the
 * add-skill panel that starts the calibration flow.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';

interface SkillView {
  gapId: string;
  title: string;
  status: string;
  objectivesTotal: number;
  objectivesCleared: number;
  percent: number;
  started: boolean;
}

const NEW_SUBJECTS = ['SQL foundations', 'Conversational Korean', 'Systems design'] as const;

const symbolFor = (title: string): string => {
  const words = title.split(/\s+/).filter(Boolean);
  return (words[0] ?? 'S').slice(0, 2);
};

export function SkillsLibrary({ skills }: { skills: SkillView[] }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().trim();
    if (!terms) return skills;
    return skills.filter((skill) => skill.title.toLowerCase().includes(terms));
  }, [skills, query]);

  return (
    <>
      <label className="arc-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Search your skills"
          aria-label="Search your skills"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="arc-skill-list">
        {filtered.map((skill) => (
          <Link
            key={skill.gapId}
            className={`arc-skill-card${skill.started ? '' : ' is-muted'}`}
            href={
              skill.started
                ? `/arc/skills/${skill.gapId}`
                : `/arc/calibrate?subject=${encodeURIComponent(skill.title)}`
            }
          >
            <span className="arc-symbol arc-symbol-large">{symbolFor(skill.title)}</span>
            <span>
              <h3>{skill.title}</h3>
              <p>
                {skill.objectivesTotal > 0
                  ? `${skill.objectivesTotal} objectives · ${skill.percent}% explored`
                  : 'Start with a 3-min AI check'}
              </p>
            </span>
            <span className="arc-skill-meta">
              {skill.started ? 'In progress\n→' : 'Not started\n+'}
            </span>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="arc-theory-text">Nothing matches “{query}”. Start a new skill below.</p>
        )}
      </div>

      <div className="arc-add-panel">
        <p>What would you like to make progress on?</p>
        <div className="arc-choices">
          {NEW_SUBJECTS.map((subject) => (
            <button
              key={subject}
              type="button"
              className={`arc-choice${chosen === subject ? ' is-selected' : ''}`}
              onClick={() => setChosen(subject)}
            >
              {subject}
            </button>
          ))}
        </div>
        <p className="arc-add-note" aria-live="polite">
          {chosen ? `${chosen} is ready for calibration.` : ''}
        </p>
        <Link
          className="arc-primary arc-full"
          href={chosen ? `/arc/calibrate?subject=${encodeURIComponent(chosen)}` : '/arc/calibrate'}
          style={{ marginTop: 10 }}
        >
          Start calibration →
        </Link>
      </div>
    </>
  );
}
