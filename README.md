# ISSB ASPIRANTS — Website

A responsive, Supabase-backed academy platform for **ISSB ASPIRANTS**. It includes the public pages, student registration/login with email verification, a separate owner-approval step, a student dashboard, a searchable notes library with protected PDF downloads, packages with a manual EasyPaisa payment-review workflow, practice-test links, announcements, a contact inbox, and a full owner/admin dashboard.

**Important:** the site is not live until you configure Supabase and run BOTH SQL files below. It cannot authenticate, save records, or grant access before then. Never claim it is live before completing the checks in section 6.

## Files

- `index.html` — page shell and navigation
- `styles.css` — responsive styling (light public theme + dark navy admin theme)
- `app.js` — routes, authentication, library access, package requests, and the admin dashboard
- `config.js` — public Supabase URL and publishable/anon key
- `supabase-schema.sql` — base tables, starter packages, RLS policies, private storage bucket, and guarded review functions
- `supabase-schema-v2.sql` — **required upgrade**: suspended accounts, resource `subject`/`file_type`/preview, the `package_resources` link table, package publish states, `site_settings`, and guarded entitlement management
- `Start ISSB Site.bat` — **double-click this** to run the site locally on Windows (starts the server and opens your browser)
- `serve.mjs` — the small dependency-free Node.js local web server the launcher runs

## 1. Create and configure Supabase

1. Create your Supabase project and keep the database password private.
2. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key).
3. Edit `config.js` and replace the two placeholder strings. The publishable/anon key is safe for browser use **only because RLS is enabled**. **Never use a service-role key here.**
4. Open **SQL Editor** and run `supabase-schema.sql`, then run `supabase-schema-v2.sql`. Both are idempotent (safe to re-run) and v2 does not delete existing data.
5. In **Authentication → URL Configuration**, set your site URL and allowed redirect URLs, and enable email confirmation.
6. Register your own account through the site, then open the confirmation email and verify it.
7. In SQL Editor, run the owner-promotion query at the bottom of `supabase-schema.sql`, replacing `YOUR-OWNER-EMAIL` with the exact email you used. Do not give the owner role to any other account.
8. In **Authentication → Providers → Email**, confirm verification is enabled. Enable MFA for the owner account.

## 2. Run locally

**Do not open `index.html` by double-clicking it.** That loads the site from a `file://` address, which breaks Supabase sign-in and can make the Dashboard/Admin pages spin forever. Always run it through the local server so the address is `http://localhost:8000`.

**Easiest way (Windows):** double-click **`Start ISSB Site.bat`** in this folder. It starts a local server (using Node.js, or Python if Node is missing) and opens `http://localhost:8000` in your browser automatically. Keep the black window open while you use the site; close it to stop the server.

The launcher runs `serve.mjs` (a small dependency-free Node server). If you prefer a terminal, any of these work from this folder:

```bash
node serve.mjs                 # Node.js (opens the browser for you)
python -m http.server 8000     # Python
```

Then open `http://localhost:8000`. Add that URL to Supabase's allowed redirect URLs while testing.

## 3. Owner dashboard (Admin nav)

Sign in as the owner and open **Admin**. The dashboard has nine sections:

- **Overview** — real counts (students, pending, approved, suspended, resources, packages, payments to review) and recent audit-log activity. No hardcoded numbers.
- **Students** — search, approve/reject, **suspend/restore**, package-access summary, and a grant/revoke package-access tool. Approval requires a verified email (enforced in the database). Suspension instantly removes protected access because every storage/resource policy requires `status='approved'`.
- **Packages** — create, edit, price, reorder, and set publish state (published / draft / archived). Changes apply immediately without redeploying.
- **Payments** — pending EasyPaisa queue plus history. Approve/reject runs the guarded `admin_review_payment` function, which re-checks the current price and the student's approved status before granting the entitlement, and writes an audit-log entry.
- **Notes & PDFs** — **upload a PDF directly**, set title/description/category/subject, free-or-paid, package link, preview flag, and publish state. Files go to the private `private-notes` bucket and are served only via short-lived (60-second) signed URLs to eligible students. Edit metadata later without re-uploading.
- **Practice tests** — add/edit/unpublish/delete external HTTPS test links.
- **Announcements** — create/edit/publish/unpublish (unpublish acts as archive).
- **Contact inbox** — read and manage submitted support/payment messages (new / read / closed).
- **Settings** — edit the contact numbers, WhatsApp channel URL, payment instructions, and contributor credits shown on the public site. Saved to `site_settings`.

## 4. Payment workflow

- A student must have a verified email and an approved profile to request a package.
- The student reads the configured EasyPaisa instructions, pays, and submits a transaction reference (TID). The request is stored as `pending` with a package-name and price snapshot.
- The owner independently verifies the transaction in EasyPaisa records, then approves it in the dashboard.
- The guarded SQL function checks the current package price and approved-student status before granting the entitlement.
- A screenshot or typed reference is **not** proof of payment. This site does **not** claim an automated EasyPaisa gateway.

## 5. Access rules (enforced in the database, not just the UI)

- Free PDFs: require an approved, active student account.
- Paid PDFs: require an approved account **and** an active entitlement for a linked package (via `package_id` or the `package_resources` link table).
- Downloads call the server-side `authorized_resource_path()` function, which re-checks eligibility before releasing the storage path; the signed URL is then gated again by the storage policy.
- Pending, rejected, and suspended accounts cannot retrieve protected files.
- Students cannot change their own role, status, payment state, or entitlements.

## 6. Before going live — test

- signup, email verification, login, logout, and password reset;
- pending users cannot access free or paid PDFs;
- unverified accounts cannot be approved (the function rejects them);
- a suspended student loses protected access immediately;
- a student cannot edit `profiles.role` or `profiles.status` directly;
- a paid resource requires an active entitlement for a linked package;
- buying one package does not unlock another;
- payment approval is manual and grants access only after a successful review;
- a student cannot read another student's payments or entitlements;
- admin routes and RPCs reject non-admin users;
- the storage bucket stays private and signed URLs expire;
- mobile navigation, search/filtering, and slow-network behavior.

## Current limitations (honest)

- Supabase is not connected until you configure `config.js` and run **both** SQL files.
- **Single active session** is not enforced. Supabase issues independent JWTs per login, so a student can be signed in on more than one device. True single-session enforcement needs trusted server-side session tracking; do not rely on a client-only flag.
- **Upload progress** is shown as an indeterminate bar (the Supabase JS client does not expose byte-level upload progress).
- PDFs already downloaded cannot be remotely recalled; revocation only blocks future authorized requests.
- Assigning the `owner` role or promoting an administrator is a privileged database action (run the promotion SQL). Ordinary admins cannot promote themselves.
- This is a build, not a security audit. Have the RLS rules reviewed and test with separate student/admin accounts before handling real data or payments.
- The website is independent and does not represent an official ISSB or armed forces service.
