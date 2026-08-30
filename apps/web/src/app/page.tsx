import { redirect } from 'next/navigation';

/**
 * The GapOS engine is the Arc app (GAP-032): the landing surface is the Arc Today screen.
 * The legacy /gaps surface remains reachable for the full engineering slice.
 */
export default function HomePage() {
  redirect('/arc');
}
