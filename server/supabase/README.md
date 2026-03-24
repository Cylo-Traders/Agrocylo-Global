## Supabase setup (dev + prod)

This backend expects two Supabase projects:

- `agrocylo-dev` for local and staging integration
- `agrocylo-prod` for production traffic

### 1) Create projects

Create both projects in the Supabase dashboard and save:

- Project URL
- anon key
- service role key
- JWT secret

Add those values to environment files based on `server/.env.example`.

### 2) Apply schema

Run the SQL in `supabase/migrations/20260324123000_init_profiles_locations_orders.sql` in each project SQL editor.

### 3) Seed dev project

Run `supabase/seed.sql` only in the dev project.

### 4) Validate performance + policy behavior

Use this proximity query pattern (PostGIS + GiST indexed):

```sql
select *
from public.farmers_within_radius(7.40, 3.90, 50000);
```

Use `explain analyze` to confirm index usage and expected latency targets under load.
