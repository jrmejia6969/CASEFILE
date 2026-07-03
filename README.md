# Casefile — Deployment Notes

Casefile lets someone upload a profile photo and paste a bio/message to check for common
catfishing and romance-scam signals. Reports of confirmed fake profiles are shared across all
visitors so a photo flagged by one person shows up as a match for the next.

## Data storage

The shared reports table lives in Netlify Database (managed Postgres), accessed through the
`/api/reports` Netlify Function (`netlify/functions/reports.mts`). There is no external service
to configure — the database provisions automatically and schema changes ship as migrations in
`netlify/database/migrations/`. Anyone can submit a report with no login, by design; the function
only accepts inserts of the report fields it expects (photo hash, name/handle, platform, note), it
doesn't expose open read/write access to the underlying database itself.

## App icons

`public/icon-192.png` and `public/icon-512.png` are included and referenced by `manifest.json`.
Swap them for your own artwork any time — same filenames, same square dimensions.

## Deploying

This site deploys on Netlify directly from the connected Git repository. Pushing to the connected
branch triggers a build (`npm run build`, publishing `dist/`) and applies any pending database
migrations automatically before the deploy goes live.

## Custom domain

In Netlify, go to Site settings → Domain management → Add custom domain, and follow the DNS
instructions it gives you.

## Testing it live

- Upload a photo, confirm the scan runs.
- Submit a report, then reload the page and upload the same photo again — confirm the match
  shows up (this proves the shared database is actually saving data).
