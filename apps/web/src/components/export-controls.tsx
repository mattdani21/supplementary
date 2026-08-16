'use client';

/**
 * Download / print controls (E25 / GAP-086). The download hits the export endpoint
 * (returns markdown with content-disposition attachment); print opens the browser's
 * print dialog, which the print stylesheet turns into a clean lesson page.
 */

import { useCallback } from 'react';

interface ExportControlsProps {
  readonly gapId: string;
  readonly lessonId: string;
}

export function ExportControls({ gapId, lessonId }: ExportControlsProps) {
  const download = useCallback(() => {
    const url = `/api/gaps/export?gapId=${encodeURIComponent(gapId)}&lessonId=${encodeURIComponent(lessonId)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lesson.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [gapId, lessonId]);

  return (
    <div className="export-controls">
      <button type="button" className="btn btn--ghost" onClick={download}>
        ↓ Download markdown
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => window.print()}>
        🖨 Print
      </button>
    </div>
  );
}
