/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

export const PARSPACK_ENDPOINT =
  process.env.PARSPACK_STORAGE_ENDPOINT || "https://c833723.parspack.net";
export const PARSPACK_ACCESS_KEY =
  process.env.PARSPACK_STORAGE_ACCESS_KEY || "Nry0nO2sPEhfhz9W";
export const PARSPACK_SECRET_KEY =
  process.env.PARSPACK_STORAGE_SECRET_KEY || "nRyUyB24uGfKdRPciQ7cJjSTHSdGG7XX";
export const PARSPACK_BUCKET =
  process.env.PARSPACK_STORAGE_BUCKET || "c833723";

const globalForS3 = globalThis as unknown as { __terrabar_parspack_s3__?: S3Client };

export function getParsPackS3Client(): S3Client {
  if (globalForS3.__terrabar_parspack_s3__) {
    return globalForS3.__terrabar_parspack_s3__;
  }

  const client = new S3Client({
    region: "default",
    endpoint: PARSPACK_ENDPOINT,
    credentials: {
      accessKeyId: PARSPACK_ACCESS_KEY,
      secretAccessKey: PARSPACK_SECRET_KEY,
    },
    forcePathStyle: true,
  });

  globalForS3.__terrabar_parspack_s3__ = client;
  return client;
}

export function cleanStorageKey(key: string): string {
  return key.replace(/^\/+/, "").replace(/\\/g, "/");
}

/**
 * Uploads a WebP buffer or file to ParsPack Object Storage
 */
export async function uploadToParsPack(
  key: string,
  body: Uint8Array | Buffer | string,
  contentType = "image/webp",
): Promise<{ key: string; url: string; success: boolean }> {
  const client = getParsPackS3Client();
  const cleanKey = cleanStorageKey(key);

  const command = new PutObjectCommand({
    Bucket: PARSPACK_BUCKET,
    Key: cleanKey,
    Body: body,
    ContentType: contentType,
  });

  await client.send(command);

  return {
    key: cleanKey,
    url: `/api/storage/file/${cleanKey}`,
    success: true,
  };
}

/**
 * Deletes a file from ParsPack Object Storage
 */
export async function deleteFromParsPack(key: string): Promise<{ success: boolean; message: string }> {
  const client = getParsPackS3Client();
  const cleanKey = cleanStorageKey(key);

  const command = new DeleteObjectCommand({
    Bucket: PARSPACK_BUCKET,
    Key: cleanKey,
  });

  await client.send(command);

  return {
    success: true,
    message: "فایل با موفقیت از فضای ابری پارس‌پک حذف شد.",
  };
}

/**
 * Fetches a file stream from ParsPack Object Storage
 */
export async function getFileFromParsPack(key: string): Promise<{
  stream: any;
  contentType: string;
  contentLength?: number;
} | null> {
  const client = getParsPackS3Client();
  const cleanKey = cleanStorageKey(key);

  try {
    const command = new GetObjectCommand({
      Bucket: PARSPACK_BUCKET,
      Key: cleanKey,
    });

    const response = await client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType || "image/webp",
      contentLength: response.ContentLength,
    };
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error("[getFileFromParsPack error]", cleanKey, err);
    throw err;
  }
}

/**
 * Lists files in ParsPack bucket
 */
export async function listParsPackFiles(prefix = ""): Promise<Array<{ key: string; size?: number; lastModified?: Date }>> {
  const client = getParsPackS3Client();
  const command = new ListObjectsV2Command({
    Bucket: PARSPACK_BUCKET,
    Prefix: prefix ? cleanStorageKey(prefix) : undefined,
  });

  const response = await client.send(command);
  return (response.Contents || []).map((item) => ({
    key: item.Key || "",
    size: item.Size,
    lastModified: item.LastModified,
  }));
}
