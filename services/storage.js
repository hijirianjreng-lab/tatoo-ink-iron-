// ink-studio/services/storage.js
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

export async function uploadImage(buffer, originalName, mimeType) {
  const ext = originalName.split('.').pop().toLowerCase();
  const key = `portfolio/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000'
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

export async function deleteImage(url) {
  if (!url || !url.startsWith(process.env.R2_PUBLIC_URL)) return;
  const key = url.replace(`${process.env.R2_PUBLIC_URL}/`, '');
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  } catch (e) {
    console.error('[storage] delete failed:', e.message);
  }
}
