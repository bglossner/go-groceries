import { ALLOWED_CONTENT_TYPES, ErrorWrapper, FileUploadRequest, FileUploadResponse, R2_FILE_UPLOAD_TYPE } from "../types";
import { generatePresignedUrl } from "../file-upload/r2-presign";
import { AppType } from "..";
import { ErrorResponse } from "@go-groceries/frontend";

export function fileUploadEndpoint(app: AppType) {
  app.post("/file-upload", async (c) => {

    let body: FileUploadRequest;
    try {
      body = await c.req.json<FileUploadRequest>();
    } catch (err) {
      return c.json({ error: 'Invalid or missing JSON body' }, 400);
    }
    const { fileUploadType, fileName, contentType, pass } = body;

    if (c.env.ENABLE_PASS !== 'false' && (!pass || pass !== c.env.PASS)) {
      return c.json({ error: 'Invalid pass provided' } satisfies ErrorResponse, 403);
    }

    try {
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return c.json(
          { error: `Invalid content type: ${contentType}` } satisfies ErrorResponse,
          400
        );
      }

      if (fileUploadType !== R2_FILE_UPLOAD_TYPE) {
        return c.json(
          { error: `Invalid file upload type: ${fileUploadType}` } satisfies ErrorResponse,
          400
        );
      }

      const url = await generatePresignedUrl(c, { contentType, filename: fileName });

      return c.json({ url } satisfies FileUploadResponse);
    } catch (error: any) {
      if (error instanceof ErrorWrapper) {
        return c.json({ error: error.message } satisfies ErrorResponse, error.statusCode);
      } else {
        console.error('Unexpected error', error);
        return c.json({ error: 'An unexpected error occurred.' } satisfies ErrorResponse, 500);
      }
    }
  });
}
