export class ErrorWrapper<ContentfulStatusCode extends number> extends Error {
  statusCode: ContentfulStatusCode;

  constructor({ message, statusCode }: { message: string, statusCode: ContentfulStatusCode }) {
    super(message);
    this.name = 'ErrorWrapper';
    this.statusCode = statusCode;
  };
}
