/**
 * Source metadata rules shared by the source form and the onboarding flow (GAP-039): the
 * media type is derived from the filename so both surfaces speak the same contract and one
 * rule change updates both.
 */

export const mediaTypeForFilename = (filename: string): string =>
  filename.endsWith('.md')
    ? 'text/markdown'
    : filename.endsWith('.html')
      ? 'text/html'
      : 'text/plain';
