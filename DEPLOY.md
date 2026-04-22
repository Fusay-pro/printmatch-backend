# PrintMatch — AWS Deployment Guide (CN392)

## Architecture
```
Browser → CloudFront (frontend static) → ALB → EC2 Auto Scaling Group → Node.js (PM2)
                                                                      ↓
                                                          RDS PostgreSQL (Multi-AZ)
                                                          S3 (files + portfolio photos)
```

---

## Step 1 — RDS PostgreSQL

1. AWS Console → RDS → Create database
   - Engine: PostgreSQL 15
   - Template: Free Tier (dev) / Production (demo)
   - DB identifier: `printmatch-db`
   - Master username: `printmatch_user`
   - Master password: strong password (save it!)
   - Instance: db.t3.micro
   - **Multi-AZ**: Yes (shows HA to professor)
   - VPC: default, **publicly accessible: No** (EC2 access only)
   - Backup retention: 7 days ✓

2. Note the **endpoint** — looks like:
   `printmatch-db.xxxx.ap-southeast-1.rds.amazonaws.com`

3. Run migrations from your local machine (via EC2 bastion or direct RDS access):
   ```bash
   psql -h <RDS_ENDPOINT> -U printmatch_user -d printmatch < schema.sql
   psql -h <RDS_ENDPOINT> -U printmatch_user -d printmatch < migrations/004_portfolio.sql
   ```

---

## Step 2 — S3 Bucket

1. AWS Console → S3 → Create bucket
   - Name: `printmatch-files` (must be globally unique, add suffix if taken)
   - Region: `ap-southeast-1`
   - Block all public access: **ON** (we use presigned URLs)
   - Versioning: **Enable** (backup requirement)

2. CORS configuration (for presigned URL uploads):
   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
       "AllowedOrigins": ["https://printmatch.yourdomain.com", "http://localhost:5173"],
       "ExposeHeaders": ["ETag"]
     }
   ]
   ```

3. IAM Role for EC2:
   - Create role: `printmatch-ec2-role`
   - Policy: `AmazonS3FullAccess` (or scoped to your bucket)
   - Attach to EC2 instances in Launch Template

---

## Step 3 — EC2 + Auto Scaling

### Launch Template
1. EC2 → Launch Templates → Create
   - AMI: Amazon Linux 2023
   - Instance type: t3.micro (or t3.small for demo)
   - Key pair: create/select one
   - Security group: allow port 80 from ALB only, port 22 from your IP
   - IAM instance profile: `printmatch-ec2-role`
   - User data: paste contents of `setup-ec2.sh`

2. Before running, you must also SCP your `.env` to the instance:
   ```bash
   scp .env ec2-user@<EC2_IP>:/home/ec2-user/printmatch/.env
   ```

### ALB (Application Load Balancer)
1. EC2 → Load Balancers → Create ALB
   - Scheme: Internet-facing
   - Listeners: HTTP :80 (add HTTPS :443 if you have a cert)
   - AZs: select **at least 2** (ap-southeast-1a + 1b)
   - Target group: HTTP, path `/health`, healthy threshold 2

### Auto Scaling Group
1. EC2 → Auto Scaling Groups → Create
   - Launch Template: the one above
   - VPC + 2 AZs
   - Load balancer: attach ALB target group
   - Desired: 2, Min: 1, Max: 5
   - Scaling policy: Target tracking, CPU 60%

---

## Step 4 — WAF (DDoS / Rate Limiting)

1. AWS Console → WAF & Shield → Create Web ACL
   - Resource: ALB
   - Add rules:
     - **AWSManagedRulesCommonRuleSet** (SQLi, XSS, etc.)
     - **AWSManagedRulesAmazonIpReputationList** (known bad IPs)
     - **Rate-based rule**: 1000 requests / 5 min per IP

2. Shield Standard is free and always on — nothing to configure.

---

## Step 5 — Frontend on S3 + CloudFront

1. Build the frontend:
   ```bash
   cd printmatch-frontend
   # Edit .env.production first — set VITE_API_URL to your ALB DNS
   npm run build
   ```

2. Create a new S3 bucket: `printmatch-frontend` (static website hosting)
   - Upload `dist/` contents

3. CloudFront → Create distribution
   - Origin: S3 bucket (use OAC)
   - Default root: `index.html`
   - Error pages: 404 → `/index.html` 200 (for React Router)
   - Cache policy: CachingOptimized

---

## Step 6 — Seed Demo Data

SSH into one EC2 instance and run:
```bash
cd /home/ec2-user/printmatch
npm run seed:demo        # 500 partners + 20 commissioners
npm run seed:portfolio   # demo portfolio photos for 10 partners
```

Clean before go-live:
```bash
npm run seed:clean
```

---

## What to Show the Professor

| Feature | How to demo |
|---|---|
| Auto Scaling | EC2 console → show 2 instances running |
| ALB | Load Balancer DNS → hit /health in browser |
| Multi-AZ RDS | RDS console → show "Multi-AZ: Yes" |
| WAF | WAF console → show rules + blocked requests log |
| S3 backup | S3 console → versioning enabled |
| CloudWatch | CloudWatch → show CPU / request count dashboard |
| Presigned S3 upload | Upload a portfolio photo in the app |

---

## Local → Production Checklist

- [ ] `.env.production` has correct ALB URL
- [ ] `npm run build` succeeds
- [ ] `.env` on EC2 has RDS endpoint, real JWT secret, real S3 bucket
- [ ] RDS security group allows EC2 security group on port 5432
- [ ] S3 CORS configured
- [ ] PM2 running: `pm2 list`
- [ ] Nginx running: `systemctl status nginx`
- [ ] ALB health check passing (green)
- [ ] CloudFront pointing to correct S3 bucket
