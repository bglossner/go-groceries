# Plan for File Retrieval Endpoint

This document outlines the plan to create a new endpoint for retrieving files from R2 storage.

## 1. Create New Files

- **`apps/go-groceries-images-meal-resolver/src/endpoints/file-retrieval.ts`**: This file will define the Hono endpoint for file retrieval.
- **`apps/go-groceries-images-meal-resolver/src/file-upload/r2-presign-get.ts`**: This file will contain the logic for generating a presigned GET URL from R2.

## 2. Implement Presigned GET URL Generation

In `apps/go-groceries-images-meal-resolver/src/file-upload/r2-presign-get.ts`:

- Create a function `generatePresignedGetUrl`.
- This function will use the `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- It will use `HeadObjectCommand` to check if the requested file (`Key`) exists in the R2 bucket. If not, it will throw an error.
- If the file exists, it will use `GetObjectCommand` to generate a presigned URL for reading the file.
- The function will accept `filename` as an argument.

## 3. Implement the File Retrieval Endpoint

In `apps/go-groceries-images-meal-resolver/src/endpoints/file-retrieval.ts`:

- Create a new Hono endpoint at `/file-retrieval` that accepts `POST` requests.
- The endpoint will expect a JSON body with a `fileName` property.
- It will call `generatePresignedGetUrl` from `r2-presign-get.ts`.
- If `generatePresignedGetUrl` throws an error because the file doesn't exist, the endpoint will return a `404 Not Found` response.
- On success, it will return a JSON response with the presigned `url`.

## 4. Update Application Entry Point

In `apps/go-groceries-images-meal-resolver/src/index.ts`:

- Import the new `fileRetrievalEndpoint`.
- Register it with the Hono app instance.

## 5. Update Types

1.  **Create a new file for shared types**:
    -   Create `apps/frontend/src/shareable/file-retrieval.ts`.
    -   Inside this file, define and export `FileRetrievalRequest` and `FileRetrievalResponse` types:
        ```typescript
        export type FileRetrievalRequest = {
          fileName: string;
        };

        export type FileRetrievalResponse = {
          url: string;
        };
        ```

2.  **Export the new types from the frontend package**:
    -   In `apps/frontend/package.json`, add a new entry to the `exports` map:
        ```json
        "./file-retrieval": {
          "types": "./src/shareable/file-retrieval.ts"
        }
        ```

3.  **Import and re-export the types in the backend**:
    -   In `apps/go-groceries-images-meal-resolver/src/types.ts`, import the new types and re-export them:
        ```typescript
        import {
          type FileRetrievalRequest,
          type FileRetrievalResponse,
        } from "@go-groceries/frontend/file-retrieval";

        export {
          type FileRetrievalRequest,
          type FileRetrievalResponse,
        };
        ```
