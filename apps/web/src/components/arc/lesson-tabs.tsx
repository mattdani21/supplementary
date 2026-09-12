'use client';

/**
 * The Arc lesson page: theory tab (real audio player + short theory text + "listen for" note)
 * and notebook tab (the real server-side proof cell). The prototype's demo JS — the regex
 * proof check and the fake audio timer — does not survive here.
 */

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArcAudioPlayer } from './arc-audio-player';
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
  readonly backHref: string;
}

export function LessonTabs(props: LessonTabsProps) {
  const { gapId, sessionId, gapTitle, lesson, audio, transcript, notebook, backHref } = props;
  const [tab, setTab] = useState<'theory' | 'notebook'>('theory');
  const id = useId();
  const theoryTab = useRef<HTMLButtonElement>(null);
  const notebookTab = useRef<HTMLButtonElement>(null);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'ArrowLeft' || event.key === 'Home'
        ? { name: 'theory' as const, ref: theoryTab }
        : { name: 'notebook' as const, ref: notebookTab };
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
          ref={notebookTab}
          id={`${id}-notebook-tab`}
          className={`arc-mode-button${tab === 'notebook' ? ' is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={tab === 'notebook'}
          aria-controls={`${id}-notebook-panel`}
          tabIndex={tab === 'notebook' ? 0 : -1}
          onKeyDown={selectFromKeyboard}
          onClick={() => setTab('notebook')}
        >
          Notebook
        </button>
      </div>

      {tab === 'theory' && (
        <div
          id={`${id}-theory-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-theory-tab`}
          tabIndex={0}
        >
          {audio && (
            <ArcAudioPlayer
              gapId={gapId}
              artefactId={audio.artefactId}
              title={lesson.title}
              durationSeconds={audio.durationSeconds}
              transcript={transcript}
            />
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
            {notebook ? (
              <button
                className="arc-primary arc-full"
                type="button"
                onClick={() => setTab('notebook')}
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

      {tab === 'notebook' && (
        <div
          id={`${id}-notebook-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-notebook-tab`}
          tabIndex={0}
        >
          <p className="arc-eyebrow">Notebook · demonstrate</p>
          <h1 className="arc-lesson-title">Show the proof.</h1>
          <p className="arc-lesson-subtitle">
            Your code runs on the server in a sandbox. A correct proof records an attempt; a miss
            changes nothing but your next try.
          </p>
          {notebook ? (
            <Notebook gapId={gapId} sessionId={sessionId} question={notebook} />
          ) : (
            <>
              <p className="arc-theory-text">
                This lesson has no notebook cell. Practise the questions on the study page instead.
              </p>
              <Link className="arc-primary arc-full" href={backHref}>
                Return to map →
              </Link>
            </>
          )}
        </div>
      )}
    </>
  );
}
