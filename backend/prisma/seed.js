import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, siteTitle: "de Stichting" }
    });

    const users = [
      { username: "Marcel", firstName: "Marcel", lastName: "Admin", role: "ADMIN" },
      { username: "Dennis", firstName: "Dennis", lastName: "Admin", role: "ADMIN" },
      { username: "Roelie", firstName: "Roelie", lastName: "Gebruiker", role: "USER" },
      { username: "Sandra", firstName: "Sandra", lastName: "Gebruiker", role: "USER" },
    ];
    const passwordHash = await bcrypt.hash("1234", 10);

    for (const u of users) {
      await prisma.user.upsert({
        where: { username: u.username },
        update: {},
        create: {
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          passwordHash,
          mustChangePassword: true
        }
      });
    }

    // sample uitje
    const uitje = await prisma.uitje.create({
      data: {
        title: "Stranddag Scheveningen",
        date: new Date(new Date().setHours(0,0,0,0) + 1000*60*60*24*21),
        description: "Dagje strand met lunch en wandeling over de boulevard.",
        collectPoint: "P+R Den Haag",
        collectTime: "09:15",
        registrationUntil: new Date(new Date().getTime() + 1000*60*60*24*14),
        cancelUntil: new Date(new Date().getTime() + 1000*60*60*24*12),
        published: true,
        showOnFrontend: true,
        mapsUrl: "https://maps.google.com",
        termsUrl: "https://example.org/algemene-voorwaarden"
      }
    });

    await prisma.event.createMany({
      data: [
        { uitjeId: uitje.id, title: "Museum Bezoek", startTime: "10:30", endTime: "12:00", pricePP: 12.5, order: 1 },
        { uitjeId: uitje.id, title: "Rondvaart Haven", startTime: "14:00", endTime: "15:30", pricePP: 16.0, order: 3 }
      ]
    });

    await prisma.meal.createMany({
      data: [
        { uitjeId: uitje.id, title: "Lunch bij 't Strandhuis", startTime: "12:30", endTime: "13:30", order: 2 },
        { uitjeId: uitje.id, title: "Diner Pizza", startTime: "18:00", endTime: "19:00", order: 5 }
      ]
    });

    await prisma.travel.createMany({
      data: [
        { uitjeId: uitje.id, title: "Reis naar Scheveningen", startTime: "09:30", endTime: "10:15", mode: "car", from: "P+R", to: "Scheveningen", order: 0 },
        { uitjeId: uitje.id, title: "Terugreis", startTime: "21:00", endTime: "22:00", mode: "car", from: "Scheveningen", to: "P+R", order: 6 }
      ]
    });

    console.log("Seed complete.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
