# PrintMatch API

3D printing commission marketplace backend — Node.js + Express + PostgreSQL (RDS) + Socket.io

## Project structure

```
printmatch/
├── schema.sql              # Full PostgreSQL schema
├── setup-ec2.sh            # EC2 setup script
├── .env.example            # Environment variables template
└── src/
    ├── server.js           # Entry point + Socket.io
    ├── db/pool.js          # PostgreSQL connection pool
    ├── middleware/auth.js  # JWT middleware
    ├── utils/matching.js   # Match score + price formula
    └── routes/
        ├── auth.js         # Register, login, me
        ├── jobs.js         # Jobs CRUD + fail/reprint/requeue
        ├── printers.js     # Printer profiles + matching
        ├── misc.js         # Quotes, payments, progress, reviews, messages
        └── upload.js       # S3 presigned URLs
```

## Local setup

```bash
cp .env.example .env
# Fill in your DB and AWS credentials

npm install
npm run dev
```

## AWS setup

### RDS (PostgreSQL)
1. Create RDS PostgreSQL instance (db.t3.micro for dev)
2. Set DB_HOST in .env to the RDS endpoint
3. Run schema: `psql -h <rds-endpoint> -U printmatch_user -d printmatch -f schema.sql`

### S3
1. Create S3 bucket: `printmatch-files`
2. Block public access (presigned URLs only)
3. Add CORS policy:
```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET", "PUT", "POST"],
  "AllowedOrigins": ["*"],
  "ExposeHeaders": []
}]
```

### EC2
1. Launch EC2 (Amazon Linux 2023, t3.small+)
2. Open ports: 22 (SSH), 80 (HTTP), 3000 (Node, internal only)
3. Run: `bash setup-ec2.sh`
4. Copy app files + .env
5. `npm install && pm2 start src/server.js --name printmatch`

### ALB
1. Create Application Load Balancer
2. Target group → EC2 instances on port 80
3. Health check: GET /health → 200

## API reference

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| GET  | /api/auth/me | Current user + printer status |

### Jobs
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/jobs | Post a job |
| GET  | /api/jobs | List jobs |
| GET  | /api/jobs/:id | Job detail |
| PATCH | /api/jobs/:id/status | Update status |
| POST | /api/jobs/:id/cancel | Cancel job |
| POST | /api/jobs/:id/fail | Report failure |
| POST | /api/jobs/:id/reprint | Request reprint |
| POST | /api/jobs/:id/requeue | Give up, re-queue |

### Printers
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/printers | Create printer profile |
| GET  | /api/printers/:id | Printer detail |
| PATCH | /api/printers/:id | Update profile |
| GET  | /api/printers/match/:jobId | Ranked matches for job |

### Quotes
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/quotes/:jobId | Submit quote |
| GET  | /api/quotes/:jobId | List quotes for job |
| PATCH | /api/quotes/:id/accept | Accept quote (triggers escrow) |
| PATCH | /api/quotes/:id/reject | Reject quote |

### Payments
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/payments/release | Release escrow to printer |
| POST | /api/payments/dispute | Freeze escrow |

### Progress
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/progress/:jobId | Post progress update |
| GET  | /api/progress/:jobId | Get all updates |

### Reviews
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/reviews/:jobId | Submit review |
| GET  | /api/reviews/printer/:printerId | Printer reviews |

### Messages
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/messages/:jobId | Send message |
| GET  | /api/messages/:jobId | Get job chat |

### Upload
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/upload/stl | Presigned URL for STL/OBJ |
| POST | /api/upload/photo | Presigned URL for photo |
| GET  | /api/upload/download/:key | Presigned download URL |

## Matching score formula

```
score = (distance_score × 0.30)
      + (review_score   × 0.35)
      + (price_score    × 0.20)
      + (jobs_score     × 0.15)
      - failure_penalty (max 0.30)
```

## Pricing formula

```
base = (material_cost_per_g × weight_g) + (rate_per_hour × time_hr)
final = base × complexity_multiplier × rush_multiplier
```
- complexity: simple=1.0, medium=1.2, complex=1.4
- rush: 1.3× if is_rush
