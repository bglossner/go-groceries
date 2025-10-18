export function getPresignedUrlExpirationInfo(url: string): {
  expiresAt: Date;
  secondsRemaining: number;
  filename: string;
} {
  try {
    const parsedUrl = new URL(url);
    const xAmzDate = parsedUrl.searchParams.get('X-Amz-Date');
    const xAmzExpires = parsedUrl.searchParams.get('X-Amz-Expires');

    if (!xAmzDate || !xAmzExpires) {
      throw new Error(`No date or expiration given on ${url}`);
    }

    // Convert X-Amz-Date (e.g. 20250913T234617Z) to a JS Date
    const sigDate = new Date(
      xAmzDate.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        '$1-$2-$3T$4:$5:$6Z'
      )
    );

    const expiresInSeconds = parseInt(xAmzExpires, 10);
    const expiresAt = new Date(sigDate.getTime() + expiresInSeconds * 1000);

    const now = new Date();
    const secondsRemaining = Math.max(
      Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      0
    );

    const pathSegments = parsedUrl.pathname.split('/');
    const filename = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : null;

    if (!filename) {
      throw new Error(`File name not found in ${url}`)
    }

    return {
      expiresAt,
      secondsRemaining,
      filename,
    };
  } catch (err) {
    console.error('Failed to parse presigned URL expiration:', err);
    throw err;
  }
}
