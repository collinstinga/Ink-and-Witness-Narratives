# Literary Circle staging resource checkpoint

Date: 2026-10-23 (Africa/Nairobi)

Branch: `feature/literary-circle-upgrade`

Activation tooling commit: `929de04`

## Connected resource verification

Authenticated Vercel metadata inspection confirmed the linked project
`narrativesbyjake` (`prj_eVEYMHGsvNlI7lngUcdBIw245qf4`) under team
`team_Zx7GUIRM3lVN5UpUF3VjxvOg`. The team project listing returned one project.
The latest five deployment records contain no Literary Circle branch deployment.
The latest listed production deployment is READY at commit
`f51df2dfb131249728db4023d93760d52c739a0c`.

Environment metadata was requested with decryption disabled. No credential
values were printed or copied. Findings:

- `FIREBASE_SERVICE_ACCOUNT_JSON` exists only for production as a protected
  sensitive variable; it is unavailable to previews.
- No `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, staging project allow-list,
  dedicated click secret, or required click-ledger mode appears in the returned
  environment-variable metadata.
- M-Pesa credential and callback variables are assigned to both production and
  preview. Shared scoping does not prove their values, but does not establish
  payment isolation either. The current STK implementation explicitly targets
  production; setting `MPESA_ENV=sandbox` alone is not sufficient evidence that
  requests will use a sandbox endpoint.
- Local `.env.local` and the process environment contain none of the six staging
  Firebase/click activation variables checked. No local backup directory was
  available for rehearsal.
- No callable Firebase or Google Cloud project/IAM tool is available in the
  connected tool inventory. Vercel access does not grant Google Cloud IAM access
  or permission to retrieve a protected production credential.

## Concrete prerequisites for the next staging operation

1. Provision or identify a separate staging Firebase project and database. Make
   its exact project and database IDs available as configuration. Production
   data must remain in its current project.
2. Install a staging-only Firebase Admin credential in a protected local process
   environment as `FIREBASE_SERVICE_ACCOUNT_JSON`, or an approved local secret
   file loaded into that process. Do not paste it in chat or tracked files.
3. Obtain an approved read-only production backup through a secure credential
   path, verify the actual affiliate count, and prepare an authorized staging
   dataset. Nine remains an expected count, not a newly verified live fact.
4. Before any preview deployment, configure branch-specific isolated Firebase,
   session/admin, application URL, email, and payment settings. Use mocked
   payment transports for financial rehearsals until sandbox routing is proven.
   Never send an STK request merely to test whether shared credentials are live.
5. Follow `docs/literary-circle-migration.md` for backup, founding migration,
   equality checks, controlled required-mode click proof, and activation. Review
   the manifest document counts against quota before full-state comparisons.

Existing 371-test regression, TypeScript, and production-build results remain
recorded in the activation-tool checkpoint. This resource inspection changed
documentation only; it did not require repeating those checks.

## Resumption boundary

No external configuration, Firebase data, payment, email, deployment, push, or
production release changed during this inspection. The remaining blocker is
staging resource provisioning and credential availability. Once provided through
a secure path, continue with the preservation rehearsal rather than rebuilding
or rerunning already completed local implementation work.
