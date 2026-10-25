import Link from 'next/link';
import { arcCapabilitiesHandler, arcSkillsHandler } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';
import { viewerOwner } from '../../../lib/viewer';
import { SkillsLibrary } from '../../../components/arc/skills-library';

export const dynamic = 'force-dynamic';

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
  filledAt: Date;
}

export default async function ArcSkillsPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const [{ skills }, { capabilities }] = (await Promise.all([
    arcSkillsHandler(context, owner),
    arcCapabilitiesHandler(context, owner),
  ])) as [{ skills: SkillView[] }, { capabilities: CapabilityView[] }];

  return (
    <>
      <div className="arc-head">
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Library</p>
          <h1>Skills</h1>
          <p>
            Choose a direction, or open the <Link href="/arc/catalog">catalog</Link> for placement
            into a syllabus.
          </p>
        </div>
        <div className="arc-head-actions">
          <Link className="arc-icon-button" href="/arc/catalog" aria-label="Open catalog">
            ⌕
          </Link>
          <Link className="arc-icon-button" href="/arc/calibrate" aria-label="Add a skill">
            +
          </Link>
        </div>
      </div>
      <SkillsLibrary
        skills={skills}
        capabilities={capabilities.map((capability) => ({
          ...capability,
          filledAt: capability.filledAt.toISOString(),
        }))}
      />
    </>
  );
}
