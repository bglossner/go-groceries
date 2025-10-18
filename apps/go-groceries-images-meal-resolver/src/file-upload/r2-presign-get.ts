import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { AppContext, ErrorWrapper } from "../types";
import { getS3Client } from "./s3-client";

export const generatePresignedGetUrl = async (c: AppContext, filename: string) => {
  if (!filename) {
    throw new ErrorWrapper({ message: "Missing 'filename' parameter", statusCode: 400 });
  }

  const s3 = getS3Client(c);

  try {
    await s3.send(new HeadObjectCommand({
      Bucket: c.env.R2_BUCKET_NAME,
      Key: filename,
    }));
  } catch (error) {
    // Assuming the error means the object doesn't exist
    throw new ErrorWrapper({ message: "File not found", statusCode: 404 });
  }

  const command = new GetObjectCommand({
    Bucket: c.env.R2_BUCKET_NAME,
    Key: filename,
  });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 60 * 60 * 24,
  });

  return signedUrl;
};
