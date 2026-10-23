# Literary Circle payment isolation checkpoint

Date: 2026-10-23 (Africa/Nairobi)

Branch: `feature/literary-circle-upgrade`

## Inspection

Authenticated Firebase Console inspection succeeded as `collinstinga@gmail.com`.
The project selector listed `ink-and-witness-narratives` and
`divine-experience-pq6d2`; no staging project was listed. The production default
database had two enabled comments indexes. No production index was changed.

A new staging project form was prepared with optional Developer Program and
Gemini enrollment disabled, but project creation was not completed or verified.
Chrome subsequently disconnected. No staging project or database ID should be
assumed to exist. Resume by listing projects before attempting creation again.

## Local build change

Added server-only `MPESA_NETWORK_MODE` with `disabled` and `live` values. Empty
configuration preserves current production and local behavior. Vercel preview,
development, and custom non-production deployments default to blocked unless
explicitly opted into `live`. Unknown switch values fail closed.

`MPESA_ENV=sandbox` and other unsupported provider environments now fail closed:
the existing integration implements production endpoints only. This switch
does not implement or claim sandbox payment support.

OAuth checks the policy before reading credentials or returning cached tokens.
STK initiation checks before merchant configuration or intent creation. Pending
status polling remains pending without provider requests or terminal mutations.
Existing confirmed payments still report their stored successful status and
reader access. Each provider fetch, including retries, rechecks the switch.
Callback validation and settlement logic are unchanged.

## Staging configuration

Set `MPESA_NETWORK_MODE=disabled` explicitly in the isolated staging environment.
Do not copy production credentials to enable payment testing. Exercise financial
flows through mocked transports until a separately reviewed sandbox integration
exists. The gate does not isolate Firebase, email, bank payments, or other
services; the earlier staging resource prerequisites still apply.

Before any production release, verify that `MPESA_ENV` really is `production`
and `MPESA_NETWORK_MODE` is empty or `live`. The old code ignored MPESA_ENV, so
a previously mislabeled sandbox configuration must be corrected deliberately.

## Verification

- The initial concurrent run passed five suites but timed out in the two store
  suites' 60-second import hooks, skipping 37 assertions. A second attempt while
  other verification processes were still active also hit a setup timeout and
  was stopped; neither attempt is counted as successful verification.
- Stopped the overlapping verification processes and reran all seven payment
  suites plus the previously timed-out affiliate credential suite with
  `--maxWorkers=1 --testTimeout=30000`: **8 files, 90 tests passed, zero skipped**.
  No test hook timeout or password work factor was weakened.
- Network-policy coverage includes preview defaults, explicit disablement,
  invalid modes, sandbox rejection, no outbound requests or merchant lookups
  while disabled, pending-state preservation, cached-token refusal after
  disablement, and confirmed-purchase access.

- Full TypeScript check passed with no diagnostics.
- Production client and server build passed. Existing CSS Highlight API and
  large-chunk warnings remain; neither is a build failure.
- Staged whitespace and targeted secret/conflict-marker checks passed.

Verification ran sequentially after the overlapping attempts were stopped;
follow that sequence on this 4 GB Windows host. No provider payment request,
Firebase write, secret retrieval, email, deployment, push, or production release
was performed in this checkpoint.
