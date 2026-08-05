'use client';

import { useRouter } from 'next/navigation';

/** Sets the learner owner cookie (single-learner deployments stay on the default). */
export function OwnerSwitcher() {
  const router = useRouter();

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('owner') as string;
    document.cookie = `gapos_owner=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <form onSubmit={apply} className="owner">
      <label htmlFor="owner">Learner</label>
      <input id="owner" name="owner" placeholder="learner id" defaultValue="" />
      <button type="submit">Switch</button>
    </form>
  );
}
