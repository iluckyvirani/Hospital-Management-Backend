# Backend Development Phases for Dimag Hospital

This document outlines the backend development phases for the Dimag Hospital Management System. Each phase includes the main modules, features, and suggested implementation order to guide the backend team.

---

## Phase 1: Project Foundation & Setup
- Initialize Node.js project (Express.js)
- Set up TypeScript (if used)
- Configure Prisma ORM and connect to database
- Create initial folder structure (controllers, routes, models, config)
- Environment variable management (.env)
- Basic error handling middleware
- User authentication (JWT/session, password hashing)
- User roles: Super Admin/Doctor, Reception, Pharmacy

---

## Phase 2: Core OPD Module
- OPD patient registration (API)
- Token generation (auto-increment, daily reset)
- OPD patient list (filter, search)
- OPD slip generation (data endpoint)
- Barcode generation (unique per OPD slip)
- OPD payment/fee management

---

## Phase 3: Room & Doctor Management
- CRUD for room types, rooms, beds
- Bed status management (available, occupied, cleaning)
- CRUD for doctor profiles
- Doctor schedule/availability management

---

## Phase 4: IPD (Inpatient) Module
- Admit patient API (from OPD or new)
- Admitted patient list
- Room/bed assignment logic
- Deposit management (add, update, track)
- Patient status flow (admit, in treatment, discharge)

---

## Phase 5: Services Module
- CRUD for hospital services
- Assign services to admitted patients
- Service billing and records

---

## Phase 6: Pharmacy Module
- CRUD for medicines (if required)
- Prescription management (doctor writes, pharmacy dispenses)
- Pharmacy billing (separate from main revenue)
- Pharmacy slip generation

---

## Phase 7: Patient Management
- All patients list (search, filter)
- Patient detail API (profile, admit history, reports, medicine, services, payments)
- Medical report/document upload endpoints

---

## Phase 8: Billing Module
- Final bill generation for discharged patients
- Payment tracking (OPD, IPD, pharmacy, services)
- Deposit/refund management
- Bill printing endpoints

---

## Phase 9: Settings & Team Management
- Hospital settings (name, address, logo, GST, etc.)
- Team/staff management (add, edit, roles, status)
- Master data management (room types, service categories, payment modes, doctor specializations)

---

## Phase 10: Expense Management
- CRUD for expense categories
- Add/edit expenses
- Expense list with filters
- Recurring expenses logic
- Receipt upload endpoints

---

## Phase 11: Reports & Analytics
- Revenue reports (OPD, IPD, pharmacy, services)
- Patient reports (registers, visit history, discharge summary)
- Financial reports (P&L, income statement, expenses)
- Operational reports (room occupancy, doctor performance, service utilization)
- Export endpoints (PDF, Excel)
- Dashboard analytics endpoints

---

## General Backend Considerations
- Role-based access control (middleware)
- Audit logs for critical actions
- Data validation (Aadhar, phone, etc.)
- Secure password storage
- API documentation (Swagger/OpenAPI)
- Automated tests (unit/integration)
- Backup and restore scripts

---

*This plan is designed to help the backend team work in clear, manageable phases. Each phase can be developed, tested, and deployed incrementally.*



Phase 1: Foundation & Setup ✅ (Already Done)

 Node.js + Express + TypeScript project
 Prisma + PostgreSQL (Neon) connection
 Prisma schema + migrations
 JWT authentication setup
 Cloudinary integration
 Global error handler middleware
 Zod validation setup
 CORS, Helmet, rate limiting
 Morgan/Winston logging
 Folder structure finalize (routes/, controllers/, services/, middlewares/, utils/)
 .env config with all keys documented
 Database seed script (super admin user, room type configs, service categories, expense categories)


Phase 2: Auth & User Management
Auth

 POST /auth/login — email+password, return JWT access + refresh token
 POST /auth/logout — invalidate refresh token
 POST /auth/refresh — issue new access token
 POST /auth/change-password
 Role guard middleware — allowRoles('SUPER_ADMIN', 'DOCTOR') etc.
 Update lastLogin on every login (Prisma User update)

Team Management (Super Admin only)

 POST /users — create staff (Reception, Pharmacy, Doctor)
 GET /users — list all staff with filters
 GET /users/:id
 PUT /users/:id
 PATCH /users/:id/status — activate / deactivate
 DELETE /users/:id
 Audit log on all user actions


Phase 3: Doctor Management

 POST /doctors — create doctor + upload photo via Cloudinary
 GET /doctors — list (filter: status, specialization)
 GET /doctors/:id — full profile with available days
 PUT /doctors/:id — update (replace Cloudinary image if new photo uploaded)
 PATCH /doctors/:id/status — toggle active/inactive
 DELETE /doctors/:id
 GET /doctors/:id/schedule?date= — return availability + today's OPD count vs limit
 Doctor available days CRUD (linked DoctorDay table)


Phase 4: Room & Bed Management
Room Types

 GET /room-types — list all with rent
 POST /room-types — create
 PUT /room-types/:id — update rent/facilities
 DELETE /room-types/:id

Rooms

 POST /rooms — create room + auto-create beds based on totalBeds
 GET /rooms — list with bed stats (available/occupied/cleaning count)
 GET /rooms/:id — detail with all beds + their status
 PUT /rooms/:id — update room info
 DELETE /rooms/:id
 GET /rooms/available — rooms with at least 1 available bed (used during IPD admit)

Beds

 PATCH /beds/:id/status — manually change bed status (available / cleaning)
 Bed auto-set to OCCUPIED on admission, CLEANING on discharge


Phase 5: Patient Management

 POST /patients — register new patient
 GET /patients — list all (search: name, phone, Aadhar)
 GET /patients/:id — full profile
 PUT /patients/:id — update info
 GET /patients/:id/opd-history — all OPD visits
 GET /patients/:id/admit-history — all admissions
 GET /patients/:id/medicine-history — all pharmacy bills
 GET /patients/:id/service-history — all services taken
 GET /patients/:id/payments — all payments (OPD fee, deposits, final bills)
 POST /patients/:id/reports — upload medical report via Cloudinary
 GET /patients/:id/reports — list uploaded reports
 DELETE /patients/:id/reports/:reportId — remove report


Phase 6: OPD Module

 POST /opd — register OPD visit (auto-fetch doctor fee, auto-generate token)
 GET /opd — list visits (filters: date, doctorId, paymentStatus)
 GET /opd/:id — single visit detail
 PATCH /opd/:id — update diagnosis / symptoms
 PATCH /opd/:id/payment — mark payment (mode + status)
 GET /opd/token/next?date= — get next token number for a date (auto-reset daily)
 GET /opd/:id/slip — return structured slip data for frontend print


Phase 7: IPD / Admissions Module

 POST /admissions — admit patient (validate bed available → assign → set bed OCCUPIED)
 GET /admissions — list (filters: status, doctorId, date range)
 GET /admissions/:id — full admission detail (room, bed, doctor, deposits, services)
 PUT /admissions/:id — update admission info
 PATCH /admissions/:id/discharge — discharge (set bed → CLEANING, update status)

Deposits

 POST /admissions/:id/deposits — add deposit (generate receipt number)
 GET /admissions/:id/deposits — list all deposits for admission

Services

 POST /services — create service
 GET /services — list (filter: category, status)
 PUT /services/:id — update
 DELETE /services/:id
 POST /admissions/:id/services — assign service(s) to admitted patient
 GET /admissions/:id/services — list services for an admission
 DELETE /admissions/:id/services/:serviceId — remove assigned service


Phase 8: Pharmacy Module
(Revenue tracked separately — no mixing with OPD/IPD billing)

 GET /pharmacy/patients — search patient (name, phone, Aadhar)
 GET /pharmacy/prescriptions/pending — prescriptions not yet dispensed
 GET /pharmacy/prescriptions/:id — prescription detail with medicines
 POST /pharmacy/bills — create pharmacy bill (with items)
 GET /pharmacy/bills — list bills (filters: date, patientId)
 GET /pharmacy/bills/:id — bill detail for print slip
 PATCH /pharmacy/prescriptions/:id/dispense — mark prescription as dispensed

Prescriptions (Doctor writes)

 POST /prescriptions — doctor creates prescription (linked to OPD visit or admission)
 GET /prescriptions/:id
 PUT /prescriptions/:id — update medicines


Phase 9: Billing Module

 POST /billing/:admissionId/generate — generate final bill (auto-calculate: room days × rate + services + other charges − deposits)
 GET /billing/:admissionId — get bill detail
 PATCH /billing/:admissionId/pay — record final payment (mode + amount)
 GET /billing/:admissionId/print — structured data for A4 bill print
 Refund calculation logic (if deposits > total, compute refund)


Phase 10: Expense Management

 POST /expense-categories — create category
 GET /expense-categories — list
 PUT /expense-categories/:id
 DELETE /expense-categories/:id
 POST /expenses — add expense (receipt upload via Cloudinary)
 GET /expenses — list (filters: date range, category, payment mode)
 GET /expenses/:id
 PUT /expenses/:id — update (replace receipt on Cloudinary if new file)
 DELETE /expenses/:id
 GET /expenses/recurring — list recurring expenses


Phase 11: Hospital Settings

 GET /settings — get hospital settings
 PUT /settings — update (name, address, GST, print header/footer)
 PATCH /settings/logo — upload logo via Cloudinary


Phase 12: Reports & Analytics
Dashboard Stats

 GET /dashboard/stats — today's OPD count, admitted patients, free beds, today's revenue

Revenue Reports

 GET /reports/revenue/opd?from=&to= — OPD collections
 GET /reports/revenue/ipd?from=&to= — IPD room + services
 GET /reports/revenue/pharmacy?from=&to= — pharmacy only
 GET /reports/revenue/doctor?doctorId=&from=&to= — per doctor
 GET /reports/revenue/daily?date= — all collections for one day
 GET /reports/revenue/payment-modes?from=&to= — cash/card/UPI breakdown

Patient Reports

 GET /reports/patients/opd-register?from=&to=
 GET /reports/patients/ipd-register?from=&to=
 GET /reports/patients/discharge-summary?from=&to=

Financial Reports

 GET /reports/financial/income-statement?month=&year=
 GET /reports/financial/profit-loss?month=&year=
 GET /reports/financial/outstanding-bills
 GET /reports/financial/expense-report?from=&to=&categoryId=

Operational Reports

 GET /reports/operational/room-occupancy?from=&to=
 GET /reports/operational/doctor-performance?from=&to=


Phase 13: Audit Logs

 Auto-log on every POST, PUT, PATCH, DELETE via middleware
 GET /audit-logs — list (filters: userId, module, date) — Super Admin only