import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Arc — adaptive skill learning',
    short_name: 'Arc',
    description: 'Learn the gap. Prove the skill.',
    start_url: '/arc',
    display: 'standalone',
    background_color: '#f8f9f7',
    theme_color: '#f8f9f7',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
