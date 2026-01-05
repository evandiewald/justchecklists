/**
 * Migration Script: Add OWNER shares for all existing checklists
 *
 * This script creates ChecklistShare records for all existing checklists,
 * granting OWNER permissions to the original authors.
 *
 * Run this once after deploying the sharing feature schema changes.
 *
 * Usage:
 *   npx tsx scripts/migrateToSharing.ts
 */

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

// Use IAM auth for the migration script
// Make sure AWS credentials are configured via AWS CLI or environment variables
const client = generateClient<Schema>({
  authMode: 'iam',
});

async function migrateToSharing() {
  console.log('Starting migration: Creating OWNER shares for existing checklists...');

  try {
    // Fetch all checklists
    const result = await client.models.Checklist.list();
    const checklists = result.data || [];

    console.log(`Found ${checklists.length} checklists to migrate`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const checklist of checklists) {
      try {
        // Check if OWNER share already exists
        const existingShare = await client.models.ChecklistShare.get({
          checklistId: checklist.id,
          userId: checklist.author,
        });

        if (existingShare.data) {
          console.log(`Skipping checklist ${checklist.id} - OWNER share already exists`);
          skipCount++;
          continue;
        }

        // Create OWNER share for the original author
        await client.models.ChecklistShare.create({
          checklistId: checklist.id,
          userId: checklist.author,
          role: 'OWNER',
          sharedBy: checklist.author,
          createdAt: new Date().toISOString(),
        });

        console.log(
          `✓ Created OWNER share for checklist "${checklist.title}" (${checklist.id}) - Author: ${checklist.author}`
        );
        successCount++;
      } catch (error) {
        console.error(
          `✗ Error creating share for checklist ${checklist.id}:`,
          error
        );
        errorCount++;
      }
    }

    console.log('\nMigration complete!');
    console.log(`- Successfully created: ${successCount} shares`);
    console.log(`- Skipped (already exists): ${skipCount} shares`);
    console.log(`- Errors: ${errorCount} shares`);

    if (errorCount > 0) {
      console.error('\nSome shares failed to create. Please review errors above.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  }
}

// Run migration
migrateToSharing()
  .then(() => {
    console.log('\nMigration successful!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration failed:', error);
    process.exit(1);
  });
