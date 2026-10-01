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

## Project structure

```text
random-group-maker/
├── index.html
├── student.html
├── admin.html
├── css/
│   └── style.css
├── js/
│   ├── config.js
│   ├── common.js
│   ├── student.js
│   └── admin.js
└── supabase/
    └── schema.sql
```

## 1. Create a Supabase project

1. Create a project at https://supabase.com/
2. Open **SQL Editor**.
3. Create a new query.
4. Paste the complete contents of `supabase/schema.sql`.
5. Run it.

The SQL creates the database tables, security policies, RPC functions, indexes, and Realtime configuration.

## 2. Create the facilitator account

In Supabase:

1. Open **Authentication → Users**.
2. Create a user with an email and password.
3. Copy that user's UUID.
4. In SQL Editor, run:

```sql
insert into public.facilitators(user_id)
values ('PASTE-THE-AUTH-USER-UUID-HERE');
```

Only users listed in `facilitators` can use the admin dashboard.

You can create additional facilitator accounts later and add each UUID to this table.

## 3. Get your Supabase browser credentials

Open:

**Project Settings → API**

Copy:

- Project URL
- Publishable key (or the legacy `anon` key)

Open `js/config.js` and replace:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-PUBLISHABLE-OR-ANON-KEY"
};
```

Do NOT use a `service_role` or secret key in the website.

The publishable/anon key is intended for frontend use when RLS is correctly configured.

## 4. Optional but recommended: verify Realtime

The SQL file adds the relevant tables to the `supabase_realtime` publication.

In the Supabase dashboard, you can also inspect:

**Database → Publications → supabase_realtime**

The app listens to:

- `groups`
- `sessions`
- `assignments` (admin only)

## 5. Test locally

Because this is a static website, you can use a simple local server.

If Python is installed:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not double-click the HTML files if the browser blocks requests. Use a local HTTP server.

## 6. Create a session

1. Open `admin.html`.
2. Log in.
3. Enter subject and class/section.
4. Enter total students and number of groups.
5. For equal groups, the app automatically distributes the remainder.

Example:

36 students / 7 groups:

- Group 1–6 = 5
- Group 7 = 6

For custom sizes, check **Use custom group sizes** and enter every capacity. The capacities must add up exactly to total students.

6. Click **Create Session**.
7. Click **Start Session**.
8. Click **Copy Student Link**.
9. Send the link to the class.

## 7. GitHub Pages deployment

1. Create a GitHub repository.
2. Upload all files/folders in this project.
3. In `js/config.js`, make sure your Supabase URL and publishable/anon key are correct.
4. Commit the changes.
5. In GitHub, open **Settings → Pages**.
6. Choose **Deploy from a branch**.
7. Select your main branch and `/root` folder.
8. Save.
9. Wait for GitHub Pages to publish the site.

Your student/admin pages will be available under the GitHub Pages site.

For example:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/student.html?session=SESSION-UUID
```

The facilitator can use:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/admin.html
```

## 8. Supabase Auth URL configuration

For production authentication, add your GitHub Pages URL to the Supabase Authentication URL settings.

Set your site URL to your deployed GitHub Pages address, for example:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/
```

If you use a custom domain later, update the URL settings accordingly.

## Security model

### Students

Students use the public student page. They can:

- Read session metadata.
- Read group capacity/counts.
- Call the database assignment RPC.
- Retrieve their own assignment using a random browser participant token.

They cannot directly insert/update/delete assignments or groups.

### Facilitators

Facilitators authenticate through Supabase Auth.

The `facilitators` table determines who can use facilitator RPCs and manage session data.

### Why the random assignment is safe

The browser never chooses:

```text
random group number → insert
```

Instead, the browser calls:

```text
pick_group(...)
```

Postgres:

1. Locks the session.
2. Checks the session is active.
3. Checks whether this browser token already has an assignment.
4. Checks whether the normalized student name already exists.
5. Selects an available group randomly.
6. Locks that group row.
7. Inserts the assignment.
8. Increments `assigned_count`.
9. Marks the session full when no slots remain.

This is why two nearly simultaneous requests cannot both consume the same final group slot.

## Duplicate names

Names are unique within a session after trimming repeated spaces and ignoring capitalization.

Example:

```text
Juan Dela Cruz
juan dela cruz
Juan   Dela   Cruz
```

are treated as the same name.

If a student refreshes their browser, their generated participant token lets the app restore their existing assignment without using the name as the primary lookup key.

## Reset behavior

Reset permanently removes the current assignments for that session and sets every group count to zero.

The confirmation dialog is intentional.

Previous sessions are independent. Resetting one session does not affect another session.

## Important production notes

- Never expose the Supabase service-role/secret key.
- Keep RLS enabled.
- Do not remove the provided RLS policies unless you understand the security consequences.
- The student token is stored in browser localStorage only as an identity/recovery aid. The database remains the source of truth.
- If students clear browser storage before the session ends, they can no longer use the old token to restore their result. The database still contains their assignment, and the duplicate-name protection prevents the same name from receiving another slot.
- If you need stronger identity verification than names, add school login/SSO or a student ID workflow.

## Troubleshooting

### "Unable to load this session"

Check:

- `js/config.js`
- Supabase project URL
- publishable/anon key
- SQL schema was run successfully
- session UUID in the student URL is valid

### Admin login fails

Check:

- the account exists in Supabase Authentication → Users
- the password is correct
- the account's UUID was inserted into `public.facilitators`

### Students do not see live counts

Check:

- `groups` is in `supabase_realtime`
- browser console for errors
- Supabase project is online
- RLS and SELECT grants from the schema are present

### RPC errors

Open Supabase **SQL Editor** and confirm the functions exist under:

**Database → Functions**

Also inspect the browser console for the exact error.

## Database tables

### facilitators

Maps a Supabase Auth user to facilitator/admin access.

### sessions

Stores subject/class/session configuration and lifecycle status.

### groups

Stores each group's configured capacity and current assigned count.

### assignments

Stores the student name, session, group, unique participant token, and assignment timestamp.

## Status flow

```text
DRAFT
  ↓ Start Session
ACTIVE
  ↓ last slot assigned
FULL

ACTIVE
  ↓ End / Archive
ENDED
```

Reset changes a session back to `ACTIVE` and removes its assignments.
