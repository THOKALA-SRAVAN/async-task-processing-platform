import { execSync } from 'child_process';

export async function setup(): Promise<void> {
  const dbUrl = new URL(process.env.DATABASE_URL!);
  const password = decodeURIComponent(dbUrl.password);
  const user     = dbUrl.username;
  const host     = dbUrl.hostname;
  const port     = dbUrl.port || '5432';
  const database = dbUrl.pathname.slice(1);

  // Create the test database if it doesn't exist
  try {
    execSync(
      `psql -h ${host} -p ${port} -U ${user} -d postgres -c "CREATE DATABASE \\"${database}\\""`,
      { stdio: 'pipe', env: { ...process.env, PGPASSWORD: password } },
    );
  } catch {
    // Database already exists — ignore
  }

  // Apply migrations against the test database
  execSync('npx prisma migrate deploy', { stdio: 'pipe' });
}
