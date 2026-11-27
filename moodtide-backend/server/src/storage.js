// Audio storage for creator uploads (task A33: Cloudflare R2, private bucket).
// Creates short-lived signed PUT URLs (10 min) and signed GET URLs for approved tracks.
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
export const SIGNED_UPLOAD_TTL_SEC = 10 * 60;     // 10 minutes
export const SIGNED_READ_TTL_SEC = 60 * 60;       // 1 hour

let cachedClient = null;
let testAdapter = null;

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function getClient(cfg) {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  return cachedClient;
}

/** True when Cloudflare R2 env vars are configured (or a test adapter is installed). */
export function isStorageConfigured() {
  return Boolean(testAdapter || getR2Config());
}

/** Override storage operations in automated tests. Pass null to restore default R2 behavior. */
export function setStorageAdapter(adapter) {
  testAdapter = adapter;
}

/**
 * Create a short-lived signed PUT URL (10 minutes) for one audio file.
 * Returns null if storage is not configured.
 */
export async function createSignedUpload(fileKey, contentType, sizeBytes) {
  if (testAdapter) return testAdapter.createSignedUpload(fileKey, contentType, sizeBytes);
  const cfg = getR2Config();
  if (!cfg) return null;

  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: fileKey,
    ContentType: contentType,
    ...(sizeBytes ? { ContentLength: sizeBytes } : {}),
  });
  const url = await getSignedUrl(getClient(cfg), cmd, { expiresIn: SIGNED_UPLOAD_TTL_SEC });
  return {
    url,
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    expires_in: SIGNED_UPLOAD_TTL_SEC,
    max_bytes: MAX_UPLOAD_BYTES,
  };
}

/** Check whether an object exists in the private bucket and read its size and content type. */
export async function headObject(fileKey) {
  if (testAdapter) return testAdapter.headObject(fileKey);
  const cfg = getR2Config();
  if (!cfg) throw new Error('Object storage is not configured');

  try {
    const res = await getClient(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: fileKey }));
    return {
      exists: true,
      size: Number(res.ContentLength ?? 0),
      contentType: (res.ContentType || '').split(';')[0].trim().toLowerCase(),
    };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
      return { exists: false };
    }
    throw err;
  }
}

/** Delete an object from the bucket (used to clean up invalid or oversized uploads). */
export async function deleteObject(fileKey) {
  if (testAdapter) return testAdapter.deleteObject(fileKey);
  const cfg = getR2Config();
  if (!cfg) return;
  await getClient(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: fileKey }));
}

/** Create a short-lived signed GET URL for an approved creator track. */
export async function createSignedRead(fileKey, expiresIn = SIGNED_READ_TTL_SEC) {
  if (testAdapter) return testAdapter.createSignedRead(fileKey, expiresIn);
  const cfg = getR2Config();
  if (!cfg) return null;

  const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: fileKey });
  return getSignedUrl(getClient(cfg), cmd, { expiresIn });
}
