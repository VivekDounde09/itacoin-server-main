// NOTE: No need to run this script,
// If not using `db:schema:push` script on staging or production env
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Running add constraint script...');

  await prisma.$transaction(async (tx) => {
    await Promise.all([
      // Wallet
      tx.$executeRaw`ALTER TABLE wallet 
        ADD CONSTRAINT wallet_amount_check CHECK (amount >= 0)
      ;`,

      // Wallet Transactions
      tx.$executeRaw`ALTER TABLE wallet_transaction 
        ADD CONSTRAINT wallet_transaction_amount_check CHECK (amount >= 0),
        ADD CONSTRAINT wallet_transaction_available_balance_check CHECK (available_balance >= 0)
      ;`,

      // Investment
      tx.$executeRaw`ALTER TABLE investment 
        ADD CONSTRAINT investment_amount_check CHECK (amount >= 0),
        ADD CONSTRAINT investment_initial_amount_check CHECK (initial_amount >= 0)
      ;`,

      // Investment Growth
      tx.$executeRaw`ALTER TABLE investment_growth 
        ADD CONSTRAINT investment_growth_month_check CHECK (month >= 1 AND month <= 12),
        ADD CONSTRAINT investment_growth_year_check CHECK (year > 0),
        ADD CONSTRAINT investment_growth_affected_check CHECK (affected >= 0),
        ADD CONSTRAINT investment_growth_processed_check CHECK (processed >= 0 AND processed <= affected)
      ;`,

      // Investment Earning
      tx.$executeRaw`ALTER TABLE investment_earning 
        ADD CONSTRAINT investment_earning_amount_check CHECK (amount >= 0),
        ADD CONSTRAINT investment_earning_earning_check CHECK (earning >= 0)
      ;`,

      // Referral Bonus
      tx.$executeRaw`ALTER TABLE referral_bonus
        ADD CONSTRAINT referral_bonus_amount_check CHECK (amount > 0),
        ADD CONSTRAINT referral_bonus_percent_check CHECK (percent > 0 AND percent <= 100)
      ;`,

      // Payment
      tx.$executeRaw`ALTER TABLE payment 
        ADD CONSTRAINT payment_amount_check CHECK (amount > 0)
      ;`,

      // Withdraw
      tx.$executeRaw`ALTER TABLE withdraw 
        ADD CONSTRAINT withdraw_amount_check CHECK (amount > 0)
      ;`,
    ]);
  });

  console.log('✅ The constraints has been added.');
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
