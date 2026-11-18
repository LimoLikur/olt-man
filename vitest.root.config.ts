import { project } from './vitest.shared.ts';

// Repo-level tests (tooling rules) that do not belong to any package.
export default project({ name: 'root' });
