import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { isEmail } from 'class-validator';
import { admin } from './seeds/admin.seed';
import { investmentBaskets } from './seeds/investment-basket.seed';
import { settings } from './seeds/setting.seed';

const program = new Command();
program.option('--seed-only <name>', 'Specify a seed name').parse(process.argv);

const prisma = new PrismaClient();

async function main() {
  const options = program.opts();

  // Seed admin default credentials
  if (!options.seedOnly || options.seedOnly === 'admin') {
    if (
      isEmail(admin.email) &&
      admin.meta?.create?.passwordHash &&
      admin.meta.create.passwordSalt
    ) {
      await prisma.admin.create({
        data: admin,
      });
    } else {
      console.error(new Error('Invalid default admin credentials found'));
    }
  }

  // Seed settings
  if (!options.seedOnly || options.seedOnly === 'setting') {
    await prisma.$transaction(async (tx) => {
      await Promise.all(
        settings.map(async (setting) => {
          await tx.setting.create({
            data: setting,
          });
        }),
      );
    });
  }

  // Seed investment baskets
  if (!options.seedOnly || options.seedOnly === 'investment-basket') {
    await prisma.investmentBasket.createMany({
      data: investmentBaskets,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
