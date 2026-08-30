import Link from 'next/link';
import { arcProfileHandler } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';
import { viewerOwner } from '../../../lib/viewer';
import { PreferencesForm, type Preferences } from '../../../components/arc/preferences-form';

export const dynamic = 'force-dynamic';

interface ProfileView {
  name: string;
  email: string;
  preferences: Preferences & { ownerId: string };
  stats: { clearedGaps: number; totalGaps: number };
}

export default async function ArcProfilePage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { profile } = (await arcProfileHandler(context, owner)) as { profile: ProfileView };

  const { audioTheory, gentleHints, darkMode, spacedReview } = profile.preferences;

  return (
    <>
      <div className="arc-head">
        <Link className="arc-icon-button" href="/arc" aria-label="Go home">
          ←
        </Link>
        <div className="arc-head-copy">
          <p className="arc-eyebrow">Settings</p>
          <h1>Profile</h1>
        </div>
      </div>

      <div className="arc-profile-hero">
        <div className="arc-profile-avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h2>{profile.name}</h2>
          <p>
            {profile.stats.clearedGaps} of {profile.stats.totalGaps} skills cleared by proof.
          </p>
        </div>
      </div>

      <div className="arc-profile-section">
        <h3>Learning preferences</h3>
        <PreferencesForm
          initial={{ audioTheory, gentleHints, darkMode, spacedReview }}
          ownerLabel={profile.name}
        />
      </div>

      <div className="arc-profile-section">
        <h3>About Arc</h3>
        <div className="arc-about">
          Arc is built around a simple promise: the path adapts to your actual goal, and progress is
          earned through evidence you can demonstrate — never by passive listening alone.
        </div>
      </div>
    </>
  );
}
