# Random Group Maker

A simple classroom random-group application using:

- HTML
- CSS
- Vanilla JavaScript
- Supabase Auth
- Supabase Postgres
- Supabase Realtime
- GitHub Pages

## What it does

Facilitators create separate sessions for any subject/class, configure equal or custom capacities, start a session, and share a student link.

Students enter their name and click **Pick My Group**. The actual random selection happens inside a PostgreSQL function/transaction, not on the student's device. Group rows are locked during assignment so the configured capacity cannot be exceeded by simultaneous clicks.
