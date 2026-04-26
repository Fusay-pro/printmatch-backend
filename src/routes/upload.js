const router = require('express').Router();
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const auth = require('../middleware/auth');

const s3Client_config = { region: process.env.AWS_REGION };
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3Client_config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
const s3 = new S3Client(s3Client_config);

const BUCKET = process.env.S3_BUCKET_NAME;
const EXPIRES = parseInt(process.env.PRESIGNED_URL_EXPIRES || '259200'); // 72h default

// POST /api/upload/stl — get presigned URL to upload STL/OBJ file
router.post('/stl', auth, async (req, res) => {
  const { filename, content_type } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const allowed = ['model/stl', 'application/octet-stream', 'model/obj', 'application/sla'];
  if (content_type && !allowed.includes(content_type))
    return res.status(400).json({ error: 'Only STL/OBJ files allowed' });

  const key = `stl/${req.user.id}/${Date.now()}-${filename}`;

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: content_type || 'application/octet-stream',
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15min to upload
    const fileUrl = `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    res.json({ upload_url: uploadUrl, file_url: fileUrl, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate upload URL' });
  }
});

// POST /api/upload/photo — presigned URL for progress photos
router.post('/photo', auth, async (req, res) => {
  const { filename, content_type } = req.body;
  const key = `photos/${req.user.id}/${Date.now()}-${filename || 'photo.jpg'}`;

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: content_type || 'image/jpeg',
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    const fileUrl = `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    res.json({ upload_url: uploadUrl, file_url: fileUrl, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate upload URL' });
  }
});

// GET /api/upload/download/:key — get presigned download URL (expires in 72h)
router.get('/download/:key(*)', auth, async (req, res) => {
  const key = req.params.key;
  // Keys are prefixed with stl/<userId>/... or photos/<userId>/...
  const userId = req.user.id;
  const allowed = key.startsWith(`stl/${userId}/`) || key.startsWith(`photos/${userId}/`);
  if (!allowed) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: EXPIRES });
    res.json({ download_url: downloadUrl, expires_in_seconds: EXPIRES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate download URL' });
  }
});

module.exports = router;
