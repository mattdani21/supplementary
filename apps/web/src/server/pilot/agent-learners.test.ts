import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_LEARNERS, agentInviteSubjects } from './agent-learners.js';

describe('private-beta agent cohort', () => {
  it('names exactly five isolated agent learners', () => {
    expect(AGENT_LEARNERS).toHaveLength(5);
    expect(new Set(AGENT_LEARNERS.map((agent) => agent.ownerId)).size).toBe(5);
    expect(new Set(AGENT_LEARNERS.map((agent) => agent.email)).size).toBe(5);
    expect(agentInviteSubjects().split(',')).toHaveLength(5);
  });
});

describe('private-beta terms and privacy', () => {
  it('state that this is an invited beta, not a public launch', () => {
    const terms = readFileSync(new URL('../../app/terms/page.tsx', import.meta.url), 'utf8');
    const privacy = readFileSync(new URL('../../app/privacy/page.tsx', import.meta.url), 'utf8');
    expect(terms).toMatch(/invite-only|invited private beta/i);
    expect(terms).toMatch(/not a public product/i);
    expect(terms).toMatch(/DeepSeek/);
    expect(terms).toMatch(/five\s+named agent learners/i);
    expect(privacy).toMatch(/invite-only/i);
    expect(privacy).toMatch(/Account deletion/);
    expect(privacy).not.toMatch(/human-authored document/);
  });
});
