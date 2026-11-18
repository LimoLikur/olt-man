import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError, type Me, setUnauthorizedHandler } from './api';
import { setTimeZone } from './format';

const MeContext = createContext<Me | null>(null);

export const useMe = (): Me => {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside RequireAuth');
  return me;
};

export const useMeQuery = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2, refetchInterval: false });

/** Redirects to /login when there is no session, and whenever any request answers 401. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMeQuery();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.clear();
      navigate('/login', { replace: true, state: { from: location.pathname } });
    });
  }, [navigate, location.pathname, qc]);

  if (me.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (me.isError || !me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  setTimeZone(me.data.timeZone);
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}
