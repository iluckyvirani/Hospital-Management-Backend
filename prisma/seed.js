require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashed = await bcrypt.hash("Admin@123", 10);

  // 1. Super Admin
  await prisma.user.upsert({
    where: { email: "admin@dimag.com" },
    update: {},
    create: {
      name: "Super Admin",
      email: "admin@dimag.com",
      phone: "9999999999",
      role: "SUPER_ADMIN",
      username: "superadmin",
      password: hashed,
    },
  });

  // 2. Doctor (user + doctor profile)
  const doctorUser = await prisma.user.upsert({
    where: { email: "doctor@dimag.com" },
    update: {},
    create: {
      name: "Dr. Rajesh Kumar",
      email: "doctor@dimag.com",
      phone: "9876543210",
      role: "DOCTOR",
      username: "doctor",
      password: hashed,
    },
  });

  await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: {},
    create: {
      userId: doctorUser.id,
      name: "Dr. Rajesh Kumar",
      specialization: "Psychiatry",
      qualification: "MBBS, MD (Psychiatry)",
      phone: "9876543210",
      email: "doctor@dimag.com",
      consultationFee: 500,
      opdLimitPerDay: 30,
      timingFrom: "09:00",
      timingTo: "17:00",
      availableDays: {
        createMany: {
          data: [
            { day: "MONDAY" },
            { day: "TUESDAY" },
            { day: "WEDNESDAY" },
            { day: "THURSDAY" },
            { day: "FRIDAY" },
            { day: "SATURDAY" },
          ],
        },
      },
    },
  });

  // 3. Reception
  await prisma.user.upsert({
    where: { email: "reception@dimag.com" },
    update: {},
    create: {
      name: "Anita Sharma",
      email: "reception@dimag.com",
      phone: "9876543211",
      role: "RECEPTION",
      username: "reception",
      password: hashed,
    },
  });

  // 4. Hospital settings for demo branding
  const existingSettings = await prisma.hospitalSettings.findFirst();
  if (!existingSettings) {
    await prisma.hospitalSettings.create({
      data: {
        name: "Dr. Help",
        address: "Demo Hospital Address",
        phone: "9999999999",
        email: "info@drhelp.com",
      },
    });
  }

  console.log("✅ Seed complete — 3 users created");
  console.log("");
  console.log("   Super Admin  →  username: superadmin   password: Admin@123");
  console.log("   Doctor       →  username: doctor       password: Admin@123");
  console.log("   Reception    →  username: reception    password: Admin@123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());