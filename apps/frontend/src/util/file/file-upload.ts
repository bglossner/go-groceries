export type UploadFileOptions = {
  location: {
    url: string;
  };
}

type ErrorType = unknown;

export class FileUploadError extends Error {
  error: ErrorType;

  constructor(message: string, error: ErrorType) {
    super(message);
    this.error = error;
  }
}

export type FileUploadResult = {
  success: true;
};

export async function uploadFile(file: File, options: UploadFileOptions): Promise<FileUploadResult> {
  const response = await fetch(options.location.url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  if (!response.ok) {
    throw new FileUploadError(`Failed to upload file`, {
      statusCode: response.status,
      statusText: response.statusText,
    });
  }

  return {
    success: true,
  };
}
