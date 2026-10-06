# FlupFlap deletion request rollout

Request inbox selected by the owner: `contact@ticash-app.com`.
The Gmail support test was sent and found in this inbox on 2026-10-06 UTC.
Staff fulfillment implementation: https://github.com/semitrack00-sys/Ticash/pull/122.
See `docs/FLUPFLAP_ACCOUNT_DELETION.md` in that PR for the verified maintenance procedure.
Proposed public resource: `https://www.flupflap.com/legal/delete-account/`.
The dedicated site build includes this page and links it from the privacy policy.
The Android draft adds Account → Delete my account, instructions, a fixed email
composer target, copyable address and a link to the same public resource.
No email is sent automatically; opening the composer is not a submission receipt.

## Before deployment and a Play declaration

- Verify the public domain serves the dedicated build and the deletion page does
  not fall through to the recharge homepage. Test from a signed-out browser.
- Inbox receipt was verified. Establish an owner, response time and a request log.
- Define the response time, identity-verification process, per-category retention
  criteria/periods and exceptions. Update the privacy policy with these decisions.
- Review and deploy the controlled backend deletion tool in the companion PR.
  Run it on a disposable staging account and perform a restore drill.
  Receiving email alone does not complete deletion.
- Translate the new Android request screen for supported release languages.

## Manual fulfillment checklist

Verify the requester controls the account; do not request passwords, card details
or identity documents through ordinary email. Acknowledge the request and explain
the next steps and expected handling time. Reconcile pending purchases, refunds
or disputes, and stop recurring recharges in the controlled account workflow.
Revoke sessions, refresh credentials and reset capabilities. Remove or anonymize
profile, recipient and other associated personal data that need not be retained.
Review linked referral/marketing data, transaction records and audit logs under
the approved retention rules. Request appropriate deletion from processors and
account for backup expiry. Confirm completion and explain any retained records
and their retention basis/duration to the customer.

Do not run an ad hoc customer-row delete: the current schema includes restrictive
relationships to recharge and marketing records. The companion staff tool erases
profile data, credentials, recipients, recurring schedules and unused quote/visit
data while retaining a deleted UUID and required financial/audit accounting links.
It refuses unresolved payments/worker claims, and commits erasure plus an audit
receipt atomically. It must be run by an authorized operator in a drained
maintenance window after verifying the customer. It does not contact external
providers or erase backups. Finalize retention periods and verify the deployed
procedure before claiming production deletion support.
