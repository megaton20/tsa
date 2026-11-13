const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const cloud = { name: process.env.CLOUDINARY_CLOUD_NAME, key: process.env.CLOUDINARY_API_KEY, secret: process.env.CLOUDINARY_API_SECRET };
const useCloud = () => Boolean(cloud.name && cloud.key && cloud.secret);

// Signed upload straight to Cloudinary's REST API (no SDK). Returns the https address of the image.
async function uploadToCloudinary(buffer, mimetype, folder) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${cloud.secret}`).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), 'upload');
  form.append('api_key', cloud.key);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud.name}/image/upload`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) throw new Error((json.error && json.error.message) || `Cloudinary error ${res.status}`);
  return json.secure_url;
}

// Image uploads. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to keep images
// across restarts; otherwise they go to public/uploads/<subdir> on the server's own disk.
function imageUpload(subdir, field = 'image') {
  const dir = path.join(__dirname, '..', 'public', 'uploads', subdir);
  const cloudMode = useCloud();
  if (!cloudMode) fs.mkdirSync(dir, { recursive: true });
  const up = multer({
    storage: cloudMode
      ? multer.memoryStorage()
      : multer.diskStorage({ destination: dir, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT[file.mimetype]}`) }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
  });
  return {
    run(req, res, next) {
      up.single(field)(req, res, async (err) => {
        if (err) {
          req.flash('error', err.code === 'LIMIT_FILE_SIZE' ? 'The image must be 5 MB or smaller.' : 'The image could not be uploaded.');
          return res.redirect('back');
        }
        if (cloudMode && req.file) {
          try {
            req.file.cloudUrl = await uploadToCloudinary(req.file.buffer, req.file.mimetype, `true-series/${subdir}`);
          } catch (e) {
            console.error('[upload] cloudinary failed:', e.message);
            req.flash('error', 'The image could not be saved. Please try again.');
            return res.redirect('back');
          }
        }
        return next();
      });
    },
    urlFor: (file) => file.cloudUrl || `/uploads/${subdir}/${file.filename}`,
    remove(url) {
      if (url && url.startsWith(`/uploads/${subdir}/`)) fs.unlink(path.join(__dirname, '..', 'public', url), () => {});
    },
  };
}

module.exports = { imageUpload };
