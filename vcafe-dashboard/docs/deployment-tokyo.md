# Tokyo deployment

This dashboard uses Firebase Hosting as the public CDN and forwards all
application requests to Cloud Run in `asia-northeast1` (Tokyo).

## Isolation

- Deployment project: `vcafe-admin-analytics`
- Cloud Run region: `asia-northeast1`
- Production project: `v-athome-cafe-app`
- The dashboard runtime has no IAM role in the production project.
- Discord submissions are written only to the management Firestore database.
- Production reads are performed only by the separately deployed sync job.

## Deploy from Cloud Shell

Open Cloud Shell with `vcafe-admin-analytics` selected, then run:

```bash
git clone --branch agent/nextjs-firebase-dashboard \
  https://github.com/gtakane/vcafe-app.git
cd vcafe-app/vcafe-dashboard
chmod +x deploy-tokyo.sh
./deploy-tokyo.sh
```

The deployment script creates a dedicated runtime service account, grants it
management-project-only access, deploys Cloud Run with zero minimum instances,
and applies the Firebase Hosting rewrite.
