import Link from 'next/link';
import { getGap, listSources } from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';
import { viewerOwner } from '../../../../../lib/viewer';
import { SkillSetup } from '../../../../../components/arc/skill-setup';

export const dynamic = 'force-dynamic';

interface GapView {
  readonly id: string;
  readonly title: string;
  readonly rawStatement: string;
  readonly dailyMinutes: number;
  readonly deadline?: string;
  readonly sourcePolicy: 'general_knowledge_allowed' | 'sources_only';
  readonly status: string;
}

interface SourceView {
  readonly id: string;
  readonly filename: string;
  readonly processingStatus: string;
}

export default async function ArcSkillSetupPage({
  params,
}: {
  params: Promise<{ gapId: string }>;
}) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();
  const [{ gap }, { sources }] = (await Promise.all([
    getGap(context, owner, gapId),
    listSources(context, owner, gapId),
  ])) as [{ gap: GapView }, { sources: SourceView[] }];
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  const lastRun = curriculum
    ? await context.uow.generation.getRun(owner, curriculum.runId)
    : undefined;

  return (
    <>
      <div className="arc-head">
        <Link className="arc-icon-button" href="/arc/skills" aria-label="Back to skills">
          ←
        </Link>
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Route setup</p>
          <h1>Ground the skill.</h1>
        </div>
      </div>
      <p className="arc-lesson-subtitle">
        Confirm the brief, attach trusted material, and compile one verified route.
      </p>
      <SkillSetup
        gap={gap}
        initialSources={sources}
        lastRun={
          lastRun
            ? {
                status: lastRun.status,
                ...(lastRun.error ? { error: lastRun.error } : {}),
              }
            : undefined
        }
      />
    </>
  );
}
