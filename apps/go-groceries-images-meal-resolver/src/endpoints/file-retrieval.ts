import { AppType } from "..";
import { FileRetrievalRequest, FileRetrievalResponse, R2_FILE_UPLOAD_TYPE } from "../types";
import { generatePresignedGetUrl } from "../file-upload/r2-presign-get";
import { ErrorWrapper } from "../types";
import { ErrorResponse } from "@go-groceries/frontend";

export function fileRetrievalEndpoint(app: AppType) {
  app.post("/file-retrieval", async (c) => {

    let body: FileRetrievalRequest;
    try {
      body = await c.req.json<FileRetrievalRequest>();
    } catch (err) {
      return c.json({ error: 'Invalid or missing JSON body' }, 400);
    }
    const { fileName, uploadedType, pass } = body;

    if (c.env.ENABLE_PASS !== 'false' && (!pass || pass !== c.env.PASS)) {
      return c.json({ error: 'Invalid pass provided' } satisfies ErrorResponse, 403);
    }

    if (uploadedType !== R2_FILE_UPLOAD_TYPE) {
      return c.json(
        { error: `Invalid file upload type: ${uploadedType}` } satisfies ErrorResponse,
        400
      );
    }

    try {
      const url = await generatePresignedGetUrl(c, fileName);
      return c.json({ url } satisfies FileRetrievalResponse);
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
