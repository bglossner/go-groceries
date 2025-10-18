import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { GeneratePresignedUrl } from "./presign";
import { ErrorWrapper } from "../types";
import { getS3Client } from "./s3-client";

export const generatePresignedUrl: GeneratePresignedUrl = async (c, { filename, contentType }) => {
  if (!filename) {
    throw new ErrorWrapper({ message: "Missing 'filename' parameter", statusCode: 400 });
  }

  // Create a temporary S3 client to generate the presigned URL
  const s3 = getS3Client(c);

  const command = new PutObjectCommand({
    Bucket: c.env.R2_BUCKET_NAME,
    Key: filename,
    ContentType: contentType,
  });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 300,
  });

  return signedUrl;
};
