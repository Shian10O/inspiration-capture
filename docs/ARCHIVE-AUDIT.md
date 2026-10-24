# Public archive audit

Date: 2026-10-24. A fresh Git history is used; original private histories are not included. Known credential formats, literal secret assignments, personal deployment/database identifiers, email addresses, compressed members and embedded assets were checked. Only documented mock credentials are allowed. No real credentials or private record contents were identified in this release candidate.

37 local tests passed on Node 24.22.1, including duplicate suppression, lost acknowledgements, append preservation, revocation, unauthorized rejection, standalone identity rejection and offline fresh-install packaging. Notion is mocked in this test suite. Independent cloud deployment has not been verified.

This is a static/source audit, not a penetration test or a guarantee that all unknown secret formats are detectable. See SECURITY.md. No user records or cloud databases were exported for publication.
