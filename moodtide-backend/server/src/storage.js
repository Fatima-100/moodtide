// Audio storage for creator uploads. A32 has no storage yet, so there is no upload link to give.
// A33 replaces this with a real signed URL (private bucket, valid 10 minutes, one file).
export async function createSignedUpload(_fileKey, _contentType) {
  return null;
}
