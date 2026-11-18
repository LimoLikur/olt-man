import { Link } from 'react-router';
import { buttonClass } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-7xl font-bold tracking-tight">404</p>
        <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p>
        <Link to="/" className={buttonClass('primary', 'md', 'mt-6')}>
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}
