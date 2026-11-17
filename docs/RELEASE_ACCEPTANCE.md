# Atlas OS release acceptance

Record the release commit, deployed URLs, migration parity, check date, and operator in the release ticket. Keep tokens, recovery codes and customer information out of the evidence.

| Area | Release check | Pass evidence |
| --- | --- | --- |
| Public website | Confirm the HTTPS domain serves the current build. Submit a demo request and a general contact enquiry with contact details your team controls. Submit a separate enquiry to the Support department. | The demo and contact messages reach the expected inbox with the correct reply-to. The support ticket appears in the owner console. Record the displayed references. |
| ERP | Use staging workspaces and staff accounts. Post goods receiving as Inventory, complete a counter sale as an Owner or Admin, and close the drawer. Retry the checkout after interrupting the connection. Check price, GST, invoice, payment, and stock. Repeat a restricted operation from the other workspace. | The expected stock and cash reconcile, the retry produces one sale, unrelated cash stays out of the drawer, and cross-workspace access is denied. |
| Owner console | From the private origin, exercise the primary and emergency accounts with separate authenticators. Send one report through ERP Support and use the website report above. Update a report, record a test purchase in staging, and generate a brief from the test reports. | Both enrolled owners can sign in. A normal workspace user is denied. The inbox shows both sources, the ERP reporter sees the update, the purchase totals agree with the ledger, and the provider returns a brief. |
| Recovery | Restore an approved backup to an isolated environment. Reconcile stock and financial totals. Verify authentication, staff boundaries, owner access, and any separately restored storage and service configuration. | Save the restore point, recovery timing, and reconciliation result. Use test data for checks against external providers. |

The automated PostgreSQL drill runs in ERP CI. For local acceptance, install `pg_dump` and `pg_restore` with the same major version as the disposable PostgreSQL server, then run:

```sh
ATLAS_TEST_RESTORE=1 npm run test:db
```

The drill creates a new local database from a backup of synthetic fixtures, compares stock, financial, and support data by count and content, and checks owner MFA and anonymous denial after restoration. It also removes the archive and restored database. Run the hosted restore and workflow checks separately against the release environment.

See [website delivery setup](PR51_WEBSITE_LEAD_DELIVERY.md) and [private operations setup](../README.md#private-operations-build).
