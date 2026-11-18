import type { OltSummary, OnuView } from '@olt/shared/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Identity } from './identity';

/** All OLT summaries; one cache entry shared by the sidebar, pages and quick search. */
export const useOlts = () => useQuery({ queryKey: ['olts'], queryFn: () => api.get<OltSummary[]>('/olts') });

/** Number of ONUs matching an /onus filter (the api returns the total with every page). */
export function useOnuCount(filter: Record<string, string>) {
  return useQuery({
    queryKey: ['onu-count', filter],
    queryFn: async () => (await api.get<{ total: number }>(`/onus?${new URLSearchParams({ ...filter, limit: '1' })}`)).total,
    refetchInterval: 30_000,
  });
}

/** The api's largest /onus page. */
const ONU_PAGE = 500;

/**
 * Every ONU of one OLT, read page by page. One cache entry per OLT, shared by the port tiles of
 * the OLT card and the OLT page; the cards pass a slower refresh than the page.
 */
export function useOltOnus(oltId: number, refetchInterval = 10_000) {
  return useQuery({
    queryKey: ['onus', 'olt', oltId],
    queryFn: async () => {
      const page = (n: number) => api.get<{ total: number; items: OnuView[] }>(`/onus?${new URLSearchParams({ oltId: String(oltId), limit: String(ONU_PAGE), page: String(n) })}`);
      const first = await page(1);
      const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / ONU_PAGE) - 1) }, (_, i) => page(i + 2)));
      return [first, ...rest].flatMap((p) => p.items);
    },
    enabled: Number.isInteger(oltId) && oltId > 0,
    refetchInterval,
  });
}

/** GET /olts/:id/identity. Admin and NOC only (403 for teknisi), so callers pass `enabled`. */
export function useIdentity(oltId: number, { enabled = true, refetchInterval = 10_000 }: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: ['identity', oltId], queryFn: () => api.get<Identity>(`/olts/${oltId}/identity`), enabled, refetchInterval });
}

/**
 * Pins the OLT's current identity candidates (admin or NOC, SPEC §8.4 step 2; the api refuses
 * replacing a pin), then refreshes every view of the OLT's identity and status.
 */
export function usePinIdentity(oltId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Identity>(`/olts/${oltId}/identity/pin`),
    onSuccess: async () => {
      await Promise.all([['identity', oltId], ['olt', String(oltId)], ['olts'], ['dashboard']].map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}
