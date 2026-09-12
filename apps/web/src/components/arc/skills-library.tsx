'use client';

/**
 * The Skills library: searchable list of real gaps with their real progress, plus the
 * add-skill panel that starts the calibration flow.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState } from '@gapos/ui';

interface SkillView {
  gapId: string;
  title: string;
  status: string;
  objectivesTotal: number;
  objectivesCleared: number;
  percent: number;
  started: boolean;
}

interface CapabilityView {
  gapId: string;
  title: string;
  targetCapability?: string;
  objectiveIds: readonly string[];
  filledAt: string;
}

const NEW_SUBJECTS = ['SQL foundations', 'Conversational Korean', 'Systems design'] as const;

const symbolFor = (title: string): string => {
  const words = title.split(/\s+/).filter(Boolean);
  return (words[0] ?? 'S').slice(0, 2);
};

export function SkillsLibrary({
  skills,
  capabilities,
}: {
  skills: SkillView[];
  capabilities: CapabilityView[];
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().trim();
    const active = skills.filter((skill) => skill.status !== 'filled');
    if (!terms) return { active, capabilities };
    const matches = (values: readonly string[]) =>
      values.some((value) => value.toLowerCase().includes(terms));
    return {
      active: active.filter((skill) => matches([skill.title])),
      capabilities: capabilities.filter((capability) =>
        matches([capability.title, capability.targetCapability ?? '', ...capability.objectiveIds]),
      ),
    };
  }, [skills, capabilities, query]);

  const totalResults = filtered.active.length + filtered.capabilities.length;

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

      {skills.length === 0 && capabilities.length === 0 && (
        <EmptyState
          eyebrow="Skills library"
          title="Your first route starts with one useful outcome."
          action={
            <a className="arc-primary" href="#add-skill">
              Choose a direction
            </a>
          }
        >
          Add a skill and Arc will find the smallest sequence of gaps worth proving.
        </EmptyState>
      )}

      <div className="arc-skill-list">
        {filtered.active.map((skill) => (
          <Link
            key={skill.gapId}
            className={`arc-skill-card${skill.started ? '' : ' is-muted'}`}
            href={skill.started ? `/arc/skills/${skill.gapId}` : `/arc/skills/${skill.gapId}/setup`}
          >
            <span className="arc-symbol arc-symbol-large">{symbolFor(skill.title)}</span>
            <span>
              <h3>{skill.title}</h3>
              <p>
                {skill.objectivesTotal > 0
                  ? `${skill.objectivesTotal} objectives · ${skill.percent}% explored`
                  : skill.status === 'compiling'
                    ? 'Compiling your first lesson'
                    : 'Review sources and compile'}
              </p>
            </span>
            <span className="arc-skill-meta">{skill.started ? 'In progress\n→' : 'Set up\n→'}</span>
          </Link>
        ))}
        {totalResults === 0 && (
          <EmptyState
            eyebrow="No match"
            title={`Nothing matches “${query}”.`}
            action={
              <a className="arc-secondary" href="#add-skill">
                Start a new skill
              </a>
            }
          >
            Try a broader capability, objective, or skill title.
          </EmptyState>
        )}
      </div>

      {filtered.capabilities.length > 0 && (
        <section className="arc-capability-section" aria-labelledby="retained-capabilities">
          <div className="arc-section-heading">
            <div>
              <p className="arc-eyebrow">Retained</p>
              <h2 id="retained-capabilities">Capabilities</h2>
            </div>
            <span>{filtered.capabilities.length} filled</span>
          </div>
          <div className="arc-capability-list">
            {filtered.capabilities.map((capability) => (
              <Link
                className="arc-capability-card"
                href={`/arc/skills/${capability.gapId}`}
                key={capability.gapId}
              >
                <span className="arc-capability-check" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <strong>{capability.targetCapability ?? capability.title}</strong>
                  <small>
                    {capability.objectiveIds.length} mastered objectives · filled{' '}
                    {new Date(capability.filledAt).toLocaleDateString()}
                  </small>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="arc-add-panel" id="add-skill">
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
