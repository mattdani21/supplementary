'use client';

/**
 * The Arc lesson page: theory tab (real audio player + short theory text + "listen for" note)
 * and notebook tab (the real server-side proof cell). The prototype's demo JS — the regex
 * proof check and the fake audio timer — does not survive here.
 */

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { StatusMessage } from '@gapos/ui';
import { ArcAudioPlayer } from './arc-audio-player';
import { ArcPractice, type ArcPracticeQuestion } from './arc-practice';
import { Notebook } from './notebook';

interface LessonTabsProps {
  readonly gapId: string;
  readonly sessionId: string;
  readonly gapTitle: string;
  readonly lesson: {
    lessonId: string;
    day: number;
    title: string;
    summary: string;
    script: string;
    estimatedMinutes: number;
    totalDays: number;
  };
  readonly audio?: { artefactId: string; durationSeconds: number };
  readonly transcript: string;
  readonly notebook?: {
    questionId: string;
    prompt: string;
    starterCode: string;
    hint?: string;
  };
  readonly practice: readonly ArcPracticeQuestion[];
  readonly defaultMode: 'theory' | 'practice';
  readonly backHref: string;
}

export function LessonTabs(props: LessonTabsProps) {
  const {
    gapId,
    sessionId,
    gapTitle,
    lesson,
    audio,
    transcript,
    notebook,
    practice,
    defaultMode,
    backHref,
  } = props;
  const [tab, setTab] = useState<'theory' | 'practice'>(defaultMode);
  const id = useId();
  const theoryTab = useRef<HTMLButtonElement>(null);
  const practiceTab = useRef<HTMLButtonElement>(null);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'ArrowLeft' || event.key === 'Home'
        ? { name: 'theory' as const, ref: theoryTab }
        : { name: 'practice' as const, ref: practiceTab };
    setTab(next.name);
    next.ref.current?.focus();
  };

  return (
    <>
      <div className="arc-lesson-top">
        <Link className="arc-icon-button" href={backHref} aria-label="Back to skill map">
          ←
        </Link>
        <div className="arc-lesson-progress">
          <div className="arc-lesson-bar" aria-hidden="true">
            <span style={{ width: `${(lesson.day / lesson.totalDays) * 100}%` }} />
          </div>
        </div>
        <small>
          {lesson.day} / {lesson.totalDays}
        </small>
      </div>

      <p className="arc-eyebrow">
        Day {lesson.day} · {gapTitle}
      </p>
      <h1 className="arc-lesson-title">{lesson.title}</h1>
      <p className="arc-lesson-subtitle">
        First hear the idea. Then make it tangible in a notebook.
      </p>

      <div className="arc-mode-toggle" role="tablist" aria-label="Lesson mode">
        <button
          ref={theoryTab}
          id={`${id}-theory-tab`}
          className={`arc-mode-button${tab === 'theory' ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={tab === 'theory'}
          aria-controls={`${id}-theory-panel`}
          tabIndex={tab === 'theory' ? 0 : -1}
          onKeyDown={selectFromKeyboard}
          onClick={() => setTab('theory')}
        >
          Theory
        </button>
        <button
          ref={practiceTab}
          id={`${id}-practice-tab`}
          className={`arc-mode-button${tab === 'practice' ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={tab === 'practice'}
          aria-controls={`${id}-practice-panel`}
          tabIndex={tab === 'practice' ? 0 : -1}
          onKeyDown={selectFromKeyboard}
          onClick={() => setTab('practice')}
        >
          Practice
        </button>
      </div>

      {tab === 'theory' && (
        <div
          id={`${id}-theory-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-theory-tab`}
          tabIndex={0}
        >
          {audio ? (
            <ArcAudioPlayer
              gapId={gapId}
              artefactId={audio.artefactId}
              title={lesson.title}
              durationSeconds={audio.durationSeconds}
              transcript={transcript}
            />
          ) : (
            <StatusMessage tone="warning" title="This lesson is text-only.">
              <p>
                Audio was not published, so use the verified transcript without losing progress.
              </p>
              <details className="arc-transcript-copy">
                <summary>Read transcript</summary>
                {transcript
                  .split(/\n+/)
                  .map((paragraph) => paragraph.trim())
                  .filter(Boolean)
                  .map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </details>
            </StatusMessage>
          )}
          <div className="arc-theory-text">
            <strong>{lesson.summary}</strong>
            <p>{lesson.script}</p>
          </div>
          <div className="arc-lesson-note">
            <span aria-hidden="true">✦</span>
            <span>
              <b>Listen for this:</b> the idea in one sentence — then the notebook makes it real.
            </span>
          </div>
          <div className="arc-lesson-footer">
            {notebook || practice.length > 0 ? (
              <button
                className="arc-primary arc-full"
                type="button"
                onClick={() => setTab('practice')}
              >
                Make it tangible →
              </button>
            ) : (
              <Link className="arc-primary arc-full" href={backHref}>
                Return to map →
              </Link>
            )}
          </div>
        </div>
      )}

      {tab === 'practice' && (
        <div
          id={`${id}-practice-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-practice-tab`}
          tabIndex={0}
        >
          <p className="arc-eyebrow">Practice · demonstrate</p>
          <h1 className="arc-lesson-title">Show the proof.</h1>
          <p className="arc-lesson-subtitle">
            Responses are graded on the server. Correct work records evidence; a miss schedules
            correction without pretending the objective is mastered.
          </p>
          {practice.length > 0 ? (
            <ArcPractice gapId={gapId} sessionId={sessionId} questions={practice} />
          ) : null}
          {notebook ? (
            <div className={practice.length > 0 ? 'arc-notebook-section' : undefined}>
              <Notebook gapId={gapId} sessionId={sessionId} question={notebook} />
            </div>
          ) : practice.length === 0 ? (
            <>
              <p className="arc-theory-text">
                This lesson has no practice item yet. The transcript remains available while Arc
                repairs the route.
              </p>
              <Link className="arc-primary arc-full" href={backHref}>
                Return to map →
              </Link>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
