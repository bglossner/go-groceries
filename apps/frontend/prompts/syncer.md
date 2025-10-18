## 🛠️ Task: Add Syncing Section to Settings Page

Create a new **"Syncing"** section in the **Settings** page (`apps/frontend`).

### 🔽 Subsections:

- **Sync To**
- **Sync From**

### 🧩 In the **"Sync To"** section:

- Add a button that, when clicked:
  1. Generates a file identical to the **groceries export file** created in `index.lazy.ts`.
    - Abstract the export logic from `index.lazy.ts` so it can be reused here.
  1. Save the generated file name to indexed DB (see db.ts) to a new sync table used to store the results of file syncing. It should store a sync to and sync from filename and upload type (see below). This should allow saving multiple values in the sync to and from. Maybe these should be separate tables.
  1. Use the file to make an API call to a new API with env var `import.meta.env.VITE_FILE_SYNC_BASE_URL` as the base URL to `/file-upload` and make a POST request to it with a `FileUploadRequest` body from the shareable types. It will return type `FileUploadResponse`.
  1. Use the generated file AND response URL from the above API call to call the `uploadFile` function in utils file-upload.ts to upload the file using the presigned URL.
  1. After that API call and using the file, make another to `import.meta.env.VITE_FILE_SYNC_BASE_URL` as the base URL to `/file-retrieval` as a POST request with body of `FileRetrievalRequest` from the shareable types. This should retrieve another URL to GET the file.
  1. Once done, show a "Share" button that can be used to share the URL generated from the API response of `/file-retrieval` (`FileRetrievalResponse`). This should allow users to send it to their clipboard or share via like Messages app on mobile.


