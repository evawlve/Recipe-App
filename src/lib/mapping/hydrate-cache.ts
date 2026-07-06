import type { UnifiedCandidate } from './gather-candidates';

export async function hydrateSingleCandidate(
    candidate: UnifiedCandidate,
    client?: any
): Promise<boolean> {
    return true;
}

export async function hydrateAllCandidates(
    candidates: UnifiedCandidate[],
    client?: any
): Promise<{ hydrated: number; skipped: number; errors: number }> {
    return { hydrated: 0, skipped: candidates.length, errors: 0 };
}
