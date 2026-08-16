/**
 * Developer surfaces — the owner switcher and the review queue — are hidden from
 * learners by default (GAP-088, E27). They render only on an explicit dev signal:
 * GAPOS_DEV_MODE=1 at the deployment level, or a ?dev=1 search param for one-off
 * local inspection. Pure and injectable, so the page render tests can assert both
 * states hermetically.
 */
export const isDevMode = (
  env: string | undefined,
  devParam: string | string[] | undefined,
): boolean =>
  env === '1' || devParam === '1' || (Array.isArray(devParam) && devParam.includes('1'));
