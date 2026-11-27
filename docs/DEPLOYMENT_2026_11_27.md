# Production portal deployment

Released 27 November 2026 (Asia/Kolkata).

## Database

Production Supabase project: `hrxjgbupjtikokqxjzbh` (Atals-OS). Applied migration `20261127090729_product_portals_and_entitlements` with the remote CLI. School and staff migrations were already present. Confirmed new private product, staff membership and school portal-link tables, one workspace product assignment, and unchanged counts of organizations (1), customers (1), products (0) and invoices (0). Six new public APIs are security invokers with anonymous execution denied.

Schema-only backup SHA256: `4257DC1C4BEE581AB914C2D5CB193D1E0EF83BD939DD81A5408C9FEB8E721604`. Automatic approval review rejected a separate local application-data export because it could contain sensitive production records. No application-data dump was taken.

## Hosting

- Website: https://atlas-os-8328y.web.app
- ERP: https://atlas-os-8328y-erp.web.app
- Portal directory: https://atlas-os-8328y.web.app/login

ERP source commit: `c6f0543f1067b0787b04b6bc9abd6da15ac0484a`. Build uses the production Supabase URL and publishable key, with no staging project reference. ERP preview version `1b121fa8f09a9003` was promoted to live. Website rebuilt with the production ERP URL. The private owner console is not deployed to the public ERP site.

Live smoke checks cover public pages, 48 production portal links, school parent sign-in, mobile overflow, ERP install/PWA assets and browser errors. Fixed a homepage animation race where the first animation-frame timestamp preceded initialization and produced an undefined phrase.

## Known configuration limits

Contact/demo delivery remains unconfigured: no production lead endpoint or Turnstile key was present in the previous live site. No fake delivery endpoint was introduced. Signed-in workflows were validated by the prior automated suite, not by creating production records during release.

Security advisors retain baseline warnings: one anonymous pre-request hook, 50 authenticated legacy security-definer functions, and disabled leaked-password protection. Private deny-direct-access tables increased from 21 to 24 as expected; their informational no-policy notices reflect intentional RPC-only access.

References: [private-table policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
