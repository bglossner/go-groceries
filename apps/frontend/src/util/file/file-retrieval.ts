export type RetrieveFileOptions = {
  url: string;
};

type ErrorType = unknown;

export class FileRetrievalError extends Error {
  error: ErrorType;

  constructor(message: string, error: ErrorType) {
    super(message);
    this.error = error;
  }
}

export type FileRetrievalResult = {
  success: true;
  blob: Blob;
};

export async function retrieveFile(options: RetrieveFileOptions): Promise<FileRetrievalResult> {
  const response = await fetch(options.url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new FileRetrievalError(`Failed to retrieve file from ${options.url}`, {
      statusCode: response.status,
      statusText: response.statusText,
    });
  }

  const blob = await response.blob();

  return {
    success: true,
    blob,
  };
}
