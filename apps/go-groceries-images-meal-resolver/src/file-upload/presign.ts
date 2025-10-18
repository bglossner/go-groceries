import { AppContext } from "../types";

type GeneratePresignedUrlProps = {
  filename: string;
  contentType: string;
};

export type GeneratePresignedUrl = (c: AppContext, props: GeneratePresignedUrlProps) => Promise<string>;
