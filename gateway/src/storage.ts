import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export interface StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  useSSL: boolean;
  region?: string;
}

export interface UploadResult {
  key: string;
  bucket: string;
  size: number;
  etag: string;
  url: string;
}

export class StorageService {
  private client: S3Client;
  private bucket: string;

  constructor(config: StorageConfig) {
    const protocol = config.useSSL ? 'https' : 'http';
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: `${protocol}://${config.endpoint}`,
      region: config.region ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      console.log(`[Storage] Created bucket: ${this.bucket}`);
    }
  }

  async upload(key: string, body: Buffer | string, contentType?: string): Promise<UploadResult> {
    const buffer = typeof body === 'string' ? Buffer.from(body) : body;
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType ?? 'application/octet-stream',
    }));
    return {
      key,
      bucket: this.bucket,
      size: buffer.length,
      etag: result.ETag ?? '',
      url: this.getObjectUrl(key),
    };
  }

  async download(key: string): Promise<{ body: Buffer; contentType: string }> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return {
      body: Buffer.concat(chunks),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  async list(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]> {
    const result = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    }));
    return (result.Contents ?? []).map(obj => ({
      key: obj.Key ?? '',
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ?? new Date(),
    }));
  }

  getObjectUrl(key: string): string {
    return `/${this.bucket}/${key}`;
  }
}
