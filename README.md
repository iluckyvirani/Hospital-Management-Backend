# Hospital Management System — API

REST API for a hospital management system built for doctors who run their own hospital. It covers outpatient visits (OPD), admissions, rooms and beds, prescriptions, billing and reports.

**Dashboard demo:** https://hms-inky-five.vercel.app (Doctor Dashboard)
**Frontend repo:** [Hospital-Management-Frontend](https://github.com/iluckyvirani/Hospital-Management-Frontend)

## Modules

| Module | What it covers |
|---|---|
| Auth | Login with JWT access and refresh tokens |
| Patients | Registration and search |
| OPD | Outpatient visits |
| Admissions | Admit and discharge, discharge cards |
| Rooms | Room types, rooms and beds |
| Prescriptions | Prescriptions with medicines |
| Services and billing | Service catalogue, patient services, deposits, final bills |
| Reports | Medical reports and dashboard stats |
| Expenses | Expense categories and expenses |
| Settings | Hospital settings, audit log |

Planned roles: doctor (full access), reception (OPD and patient search) and pharmacy. See [`PROJECT_DOCUMENTATION.md`](PROJECT_DOCUMENTATION.md) for the module plan.

## Tech stack

Node.js · Express · Prisma ORM · PostgreSQL (23 models) · JWT · Cloudinary · Vercel

## Run it locally

```bash
npm install
cp .env.example .env        # fill in the values
npx prisma migrate deploy
npm run dev
```

Environment variables (names only): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRY`,
`JWT_REFRESH_EXPIRY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLIENT_URL`, `PORT`.

Never commit a real `.env` file. Use `.env.example` with empty values.
