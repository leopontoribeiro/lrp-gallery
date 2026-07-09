# 📚 API Documentation - Admin Gallery Actions v2.0.0

**Version**: 2.0.0  
**Status**: Production Ready ✅  
**Last Updated**: July 8, 2026

---

## 🎯 Overview

Admin Gallery Actions provides 6 core operations for managing galleries in production:

1. ✅ Generate QR Code
2. ✅ Toggle Sharing
3. ✅ Change Cover Image
4. ✅ Soft Delete Gallery
5. ✅ Download All Photos (ZIP)
6. ✅ Download Favorite Photos (ZIP)

---

## 🔐 Authentication

All endpoints require JWT authentication. Include token in request header:

```bash
Authorization: Bearer <JWT_TOKEN>
```

Obtained from Supabase Auth after user login.

---

## 📋 Endpoints

### 1️⃣ POST /admin-api/download

**Generate ZIP with photos**

#### Request
```json
{
  "type": "gallery|group",
  "id": "uuid",
  "favorites": false
}
```

#### Response (200 OK)
```json
{
  "download_url": "https://storage.supabase.co/...",
  "file_size_mb": "15.5",
  "total_photos": 42,
  "expires_at": "2026-07-09T19:12:00Z"
}
```

#### Errors
- `400 Bad Request`: Missing type or id
- `403 Forbidden`: Not authorized (RLS check)
- `400 Bad Request`: No photos to download

#### Example
```bash
curl -X POST http://localhost:3000/admin-api/download \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"gallery","id":"abc123","favorites":false}'
```

---

### 2️⃣ PATCH /admin-api/gallery/{id}/sharing

**Toggle gallery sharing status**

#### Request
```
PATCH /admin-api/gallery/abc123/sharing
Authorization: Bearer <JWT_TOKEN>
```

#### Response (200 OK)
```json
{
  "sharing_enabled": true
}
```

#### Errors
- `403 Forbidden`: Not authorized
- `404 Not Found`: Gallery not found

#### Example
```bash
curl -X PATCH http://localhost:3000/admin-api/gallery/abc123/sharing \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3️⃣ PATCH /admin-api/group/{id}/sharing

**Toggle gallery group sharing status**

#### Request
```
PATCH /admin-api/group/group-id/sharing
Authorization: Bearer <JWT_TOKEN>
```

#### Response (200 OK)
```json
{
  "sharing_enabled": true
}
```

---

### 4️⃣ POST /admin-api/gallery/{id}/cover

**Upload new cover image**

#### Request
```
POST /admin-api/gallery/abc123/cover
Authorization: Bearer <JWT_TOKEN>
Content-Type: multipart/form-data

cover_image: <file> (max 5MB, JPEG/PNG)
```

#### Response (200 OK)
```json
{
  "cover_url": "https://storage.supabase.co/covers/gallery/abc123/..."
}
```

#### Errors
- `400 Bad Request`: No file provided
- `400 Bad Request`: File too large (>5MB)
- `400 Bad Request`: Invalid file type (only JPEG/PNG)
- `403 Forbidden`: Not authorized

#### Example
```bash
curl -X POST http://localhost:3000/admin-api/gallery/abc123/cover \
  -H "Authorization: Bearer $TOKEN" \
  -F "cover_image=@photo.jpg"
```

---

### 5️⃣ DELETE /admin-api/gallery/{id}

**Soft delete gallery**

#### Request
```
DELETE /admin-api/gallery/abc123
Authorization: Bearer <JWT_TOKEN>
```

#### Response (200 OK)
```json
{
  "success": true
}
```

#### Errors
- `403 Forbidden`: Not authorized
- `404 Not Found`: Gallery not found

#### Note
- Uses **soft delete** (marks `deleted_at` timestamp)
- Data remains in database and can be recovered
- Share links are automatically deactivated

#### Example
```bash
curl -X DELETE http://localhost:3000/admin-api/gallery/abc123 \
  -H "Authorization: Bearer $TOKEN"
```

---

### 6️⃣ POST /admin-api/group/{id}/cover

**Upload cover for gallery group**

#### Request
```
POST /admin-api/group/group-id/cover
Authorization: Bearer <JWT_TOKEN>
Content-Type: multipart/form-data

cover_image: <file> (max 5MB, JPEG/PNG)
```

#### Response (200 OK)
```json
{
  "cover_url": "https://storage.supabase.co/covers/group/..."
}
```

---

## 🎨 Frontend Integration

### Basic Usage

```javascript
// Initialize (called automatically on page load)
if (typeof initAdminActions === 'function') {
  initAdminActions(supabase, adminContext);
}

// Use individual functions
adminActions.generateQRCode(galleryId, groupId);
adminActions.toggleSharing(galleryId, groupId);
adminActions.changeCover(galleryId, groupId);
adminActions.deleteGallery(galleryId, groupId);
adminActions.downloadAllPhotos(galleryId, groupId);
adminActions.downloadFavorites(galleryId, groupId);
```

### Render Actions Menu

```javascript
const menuHTML = adminActions.renderActionsMenu(galleryId, groupId);
document.getElementById('actions-container').innerHTML = menuHTML;
```

---

## 🔍 Database Schema

### galleries (added columns)
```sql
- sharing_enabled: boolean (default: true)
- cover_image_url: text
- cover_image_hash: text (for deduplication)
- deleted_at: timestamp (NULL = active)
- deleted_by: uuid (FK to auth.users)
```

### New Tables
```sql
download_history (
  id: uuid PRIMARY KEY
  gallery_id: uuid FK
  gallery_group_id: uuid FK
  user_id: uuid FK
  download_type: text ('all' | 'favorites')
  file_size_bytes: bigint
  total_photos: integer
  downloaded_at: timestamp
)

admin_action_logs (
  id: uuid PRIMARY KEY
  admin_id: uuid FK
  action_type: text
  target_type: text ('gallery' | 'group')
  target_id: uuid
  details: jsonb
  created_at: timestamp
)
```

---

## 🛡️ Security Features

### Row Level Security (RLS)
- All queries filtered by ownership
- Users see only their galleries
- Admin actions require ownership verification

### Soft Delete
- Galleries marked with `deleted_at` timestamp
- Share links automatically deactivated
- Data recoverable if needed
- RLS filters out deleted galleries

### Admin Logging
- All actions logged in `admin_action_logs`
- Tracks: who, what, when, details
- Auditable for compliance

### File Validation
- Max 5MB for cover images
- Only JPEG/PNG accepted
- SHA-256 hash for deduplication

---

## 📊 Rate Limiting

Currently **not implemented**. Recommended:
- 100 requests per minute per user
- 10 file uploads per minute per user
- ZIP generation timeout: 30 seconds

---

## 🧪 Testing

Run integration tests:

```bash
# Include in admin.html before </body>
<script src="test-admin-gallery-actions.js"></script>

// Then in console:
const tester = new AdminActionsTests(supabase);
tester.runAll();
```

Expected output:
```
✅ QR Generation: QR Code gerado com sucesso
✅ Toggle Sharing: Toggle funcionando
✅ Change Cover: Capa atualizada com sucesso
✅ Soft Delete: Soft delete funcionando
✅ Download All: Tabela download_history acessível
✅ Download Favorites: Query de favoritas funcional

🎉 SUCESSO! Todas as ações estão operacionais!
```

---

## 🚀 Deployment

### Prerequisites
```bash
npm install express jszip dotenv
```

### Environment Variables
```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=xxxxx
NODE_ENV=production
```

### Start Backend
```bash
node server.js
# API listening on :3000
```

### CI/CD Pipeline
GitHub Actions automatically:
- ✅ Lints JavaScript/CSS
- ✅ Validates HTML
- ✅ Checks security (npm audit)
- ✅ Verifies SQL migrations
- ✅ Creates deployment summary

---

## 📈 Monitoring

### Key Metrics
- `admin_action_logs.created_at` - Action frequency
- `download_history.downloaded_at` - Download patterns
- `admin_action_logs.action_type` - Most used features

### Query Examples

```sql
-- Most used actions (last 7 days)
SELECT action_type, COUNT(*) as count
FROM admin_action_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY action_type
ORDER BY count DESC;

-- Total downloads (last 30 days)
SELECT 
  SUM(total_photos) as photos_downloaded,
  SUM(file_size_bytes) / 1024 / 1024 as total_mb,
  COUNT(*) as download_count
FROM download_history
WHERE downloaded_at > NOW() - INTERVAL '30 days';
```

---

## ❓ FAQ

**Q: What happens if a gallery is deleted?**  
A: Soft delete marks it with `deleted_at` timestamp. Photos stay in storage. RLS automatically filters it out. Reversible if needed.

**Q: Can I recover a deleted gallery?**  
A: Yes! Update the `deleted_at` column to NULL via Supabase console.

**Q: What's the maximum ZIP file size?**  
A: Currently unlimited. Recommend implementing 500MB limit for large galleries.

**Q: Who can delete galleries?**  
A: Only the gallery owner (RLS check on `owner_id`).

**Q: Are downloads logged?**  
A: Yes! Check `download_history` table for audit trail.

---

## 📞 Support

For issues or questions:
1. Check logs: `admin_action_logs` table
2. Verify RLS policies in Supabase console
3. Test with provided `test-admin-gallery-actions.js`

---

**Last Updated**: July 8, 2026  
**Status**: Production Ready ✅  
**Support**: Internal Team

