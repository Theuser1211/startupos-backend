import { PrismaClient } from '@prisma/client';

const url = 'postgresql://postgres.nqdxecolaaautinoemso:AaravGupta123@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true';

const p = new PrismaClient({ datasourceUrl: url });

try {
  await p.$connect();
  console.log('Connected');

  const tables = await p.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log('Existing tables:', JSON.stringify(tables, null, 2));

  await p.$disconnect();
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
