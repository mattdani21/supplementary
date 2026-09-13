/**
 * GOAL M4 private-beta cohort: five named agent learners, not a public signup list.
 */

import type { OwnerId } from '@gapos/database';

export interface AgentLearner {
  readonly ownerId: OwnerId;
  readonly name: string;
  readonly email: string;
  readonly subject: string;
}

export const AGENT_LEARNERS: readonly AgentLearner[] = [
  {
    ownerId: 'agent_nova' as OwnerId,
    name: 'Nova Chen',
    email: 'nova.chen@agents.gapos.local',
    subject: 'Relations and proof techniques',
  },
  {
    ownerId: 'agent_reed' as OwnerId,
    name: 'Reed Okonkwo',
    email: 'reed.okonkwo@agents.gapos.local',
    subject: 'Relations and proof techniques',
  },
  {
    ownerId: 'agent_kira' as OwnerId,
    name: 'Kira Patel',
    email: 'kira.patel@agents.gapos.local',
    subject: 'Relations and proof techniques',
  },
  {
    ownerId: 'agent_soren' as OwnerId,
    name: 'Soren Berg',
    email: 'soren.berg@agents.gapos.local',
    subject: 'Relations and proof techniques',
  },
  {
    ownerId: 'agent_vale' as OwnerId,
    name: 'Vale Dimitriou',
    email: 'vale.dimitriou@agents.gapos.local',
    subject: 'Relations and proof techniques',
  },
];

export const agentInviteSubjects = (): string =>
  AGENT_LEARNERS.map((agent) => agent.email).join(',');
