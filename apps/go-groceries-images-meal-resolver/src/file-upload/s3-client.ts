import { S3Client } from "@aws-sdk/client-s3";
import { AppContext } from "../types";

const s3Clients: { [apiKey: string]: S3Client } = {};

export const getS3Client = (c: AppContext) => {
  const apiKey = c.env.R2_ACCESS_KEY_ID;
  if (!s3Clients[apiKey]) {
    console.log('Creating new S3Client instance!');
    s3Clients[apiKey] = new S3Client({
      region: "auto",
      endpoint: `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: c.env.R2_ACCESS_KEY_ID,
        secretAccessKey: c.env.R2_ACCESS_KEY_SECRET,
      }
    });
  } else {
    console.log('Using cached S3Client instance!');
  }
  return s3Clients[apiKey];
};
