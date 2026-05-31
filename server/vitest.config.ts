import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
