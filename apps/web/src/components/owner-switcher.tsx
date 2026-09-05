'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Sets the learner owner cookie (single-learner deployments stay on the default). */
export function OwnerSwitcher() {
  const router = useRouter();
  const [current, setCurrent] = useState('');

  // Reflect the learner already stored in the cookie so the field is not confusingly blank on
  // every navigation. Read after mount to avoid a server/client hydration mismatch.
  useEffect(() => {
    const owner = document.cookie
      .split('; ')
      .find((part) => part.startsWith('gapos_owner='))
      ?.split('=')[1];
    if (owner) setCurrent(decodeURIComponent(owner));
  }, []);

  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('owner') as string;
    document.cookie = `gapos_owner=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <form onSubmit={apply} className="owner">
      <label htmlFor="owner">Learner</label>
      <input
        id="owner"
        name="owner"
        placeholder="learner id"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <button type="submit">Switch</button>
    </form>
  );
}
