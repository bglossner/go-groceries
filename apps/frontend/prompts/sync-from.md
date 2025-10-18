### 🧩 In the **"Sync From"** section on the apps/frontend settings page:

1. Add a textbox where you can input a URL like the one in `syncer.md` that got generated.
1. Add a button that says "Save New Sync Location"
1. Once that button is clicked, save that value to the DB (see the `sync` table in db.ts) as a `from` location. It can use the `s3-presigned.ts` util to parse the needed information.
1. Add a button that says "Sync DB" below.
1. When clicked, that button should check the saved `sync` from value and, if the seconds remaining to expiration are greater than 1 minute, use the presigned URL to retrieve the file contents. For now, do nothing other than show a success message.
1. If the expiration is within 1 minute, call the `file-retriever` API to get a new presigned URL and save that to the `sync` table record that exists for that `filename`. Then retrieve the file contents the same as above.
1. For each case, handle when the file-retriever API returns a 404 or the given URL for the sync location is invalid if the lookup for the file contents fails.

