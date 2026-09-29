# Lord Mahavira Academy — Farewell 2026–27
## Railway-ready Pass Portal

Single Node.js service:
- Express frontend/API
- MongoDB Atlas
- Student registration/login
- Student application
- Admin approval/rejection
- Digital QR pass
- PNG download

## Railway deployment

### 1. Upload to GitHub
Push this entire folder to a GitHub repository.

### 2. Create Railway service
Railway -> New Project -> Deploy from GitHub Repo -> select this repository.

Railway automatically runs:

```bash
npm install
npm start
```

The app listens on `process.env.PORT`.

### 3. Add variables in Railway

Variables:

```text
MONGODB_URI=xyz
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
```

`xyz` is only a placeholder. Replace it with your real MongoDB Atlas URI.

### 4. MongoDB Atlas

Create a MongoDB Atlas database and allow your Railway service to connect.

The app uses:

```text
Database: lma_farewell

Collections:
users
applications
passes
```

### 5. Open the generated Railway domain

Railway will provide a public domain such as:

```text
https://your-service.up.railway.app
```

## Admin

Go to the normal website and log in using:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
```

The admin user is created automatically on the first successful admin login.

## Security

Never put MONGODB_URI in public frontend JavaScript.

Use a long random SESSION_SECRET.

Before collecting real student information, configure MongoDB Atlas access and your school's data/privacy requirements.

## QR

The QR currently encodes the unique pass ID. It can later be upgraded to a gate-scanning verification system with:
VALID / ALREADY USED / INVALID.
