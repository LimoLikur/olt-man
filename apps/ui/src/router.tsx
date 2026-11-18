import { createBrowserRouter } from 'react-router';
import { RequireAuth } from './auth';
import { Layout } from './components/layout';
import { AccountPasswordPage } from './routes/account-password';
import { AlarmsPage } from './routes/alarms';
import { ApprovalsPage } from './routes/approvals';
import { DashboardPage } from './routes/dashboard';
import { JobPage } from './routes/job';
import { LoginPage } from './routes/login';
import { NotFoundPage } from './routes/not-found';
import { OltDetailPage } from './routes/olt-detail';
import { OltNewPage } from './routes/olt-new';
import { OltsPage } from './routes/olts';
import { OnuDetailPage } from './routes/onu-detail';
import { OnusPage } from './routes/onus';
import { ProvisionNewPage } from './routes/provision-new';
import { UsersPage } from './routes/users';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/olts', element: <OltsPage /> },
      { path: '/olts/new', element: <OltNewPage /> },
      { path: '/olts/:id', element: <OltDetailPage /> },
      { path: '/onus', element: <OnusPage /> },
      { path: '/onus/:id', element: <OnuDetailPage /> },
      { path: '/alarms', element: <AlarmsPage /> },
      { path: '/provision/new', element: <ProvisionNewPage /> },
      { path: '/jobs/:id', element: <JobPage /> },
      { path: '/approvals', element: <ApprovalsPage /> },
      { path: '/users', element: <UsersPage /> },
      { path: '/account/password', element: <AccountPasswordPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
