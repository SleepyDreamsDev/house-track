import { source999md } from './999md.js';
import type { Source } from './types.js';

const REGISTRY: ReadonlyArray<Source> = [source999md];

export function listSources(): ReadonlyArray<Source> {
  return REGISTRY;
}

export function getSource(slug: string): Source | null {
  return REGISTRY.find((s) => s.slug === slug) ?? null;
}

export const ACTIVE_SOURCE_SLUG = '999md';

export { UnknownGenericFilterValueError } from './types.js';
export type { Source, ResolvedFilter } from './types.js';
