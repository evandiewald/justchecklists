/**
 * Browser-based Migration Script: Add OWNER shares for all existing checklists
 *
 * This version can be run in the browser console while you're logged in.
 *
 * Usage:
 * 1. Log in to your app
 * 2. Open browser console (F12)
 * 3. Paste this entire script and press Enter
 * 4. Call: await runMigration()
 */

import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';

const client = generateClient<Schema>();

export async function runMigration() {
  console.log('Starting migration: Creating OWNER shares for existing checklists...');

  try {
    // Fetch all checklists using userPool auth (you must be logged in)
    const result = await client.models.Checklist.list({
      authMode: 'userPool',
    });
    const checklists = result.data || [];

    console.log(`Found ${checklists.length} checklists to migrate`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const checklist of checklists) {
      try {
        // Check if user is the owner
        const currentUser = await client.models.Checklist.get({ id: checklist.id });

        if (!currentUser.data) {
          console.log(`Skipping checklist ${checklist.id} - cannot access`);
          skipCount++;
          continue;
        }

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
    }

    return { successCount, skipCount, errorCount };
  } catch (error) {
    console.error('Fatal error during migration:', error);
    throw error;
  }
}

// For browser console usage, expose globally
if (typeof window !== 'undefined') {
  (window as any).runMigration = runMigration;
  console.log('Migration script loaded! Run with: await runMigration()');
}
