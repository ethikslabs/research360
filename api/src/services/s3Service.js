import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config/env.js'

const clientConfig = {
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
}

if (config.S3_ENDPOINT) {
  clientConfig.endpoint = config.S3_ENDPOINT
  clientConfig.forcePathStyle = true
}

const s3 = new S3Client(clientConfig)

function key(tenantId, documentId, stage) {
  return `${tenantId}/${documentId}/${stage}`
}

export async function upload(tenantId, documentId, stage, body, contentType = 'application/octet-stream') {
  await s3.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key(tenantId, documentId, stage),
    Body: body,
    ContentType: contentType,
  }))
  return key(tenantId, documentId, stage)
}

export async function download(tenantId, documentId, stage) {
  const res = await s3.send(new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key(tenantId, documentId, stage),
  }))
  const chunks = []
  for await (const chunk of res.Body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export async function presign(tenantId, documentId, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key(tenantId, documentId, 'original'),
  })
  return getSignedUrl(s3, command, { expiresIn })
}

export async function deleteAll(tenantId, documentId) {
  const prefix = `${tenantId}/${documentId}/`
  const list = await s3.send(new ListObjectsV2Command({ Bucket: config.S3_BUCKET, Prefix: prefix }))
  if (!list.Contents?.length) return
  await s3.send(new DeleteObjectsCommand({
    Bucket: config.S3_BUCKET,
    Delete: { Objects: list.Contents.map(o => ({ Key: o.Key })) },
  }))
}

export async function healthCheck() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }))
    return true
  } catch {
    return false
  }
}
