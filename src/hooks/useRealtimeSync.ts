import { useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

// Track recent mutations to ignore our own subscription events
const recentMutations = new Set<string>();

export function trackMutation(type: string, id: string) {
  const key = `${type}:${id}`;
  recentMutations.add(key);

  // Remove after 3 seconds
  setTimeout(() => {
    recentMutations.delete(key);
  }, 3000);
}

function wasRecentMutation(type: string, id: string): boolean {
  return recentMutations.has(`${type}:${id}`);
}

interface RealtimeCallbacks {
  onItemCreate?: (item: any) => void;
  onItemUpdate?: (item: any) => void;
  onItemDelete?: (itemId: string) => void;
  onSectionCreate?: (section: any) => void;
  onSectionUpdate?: (section: any) => void;
  onSectionDelete?: (sectionId: string) => void;
  onChecklistUpdate?: (checklist: any) => void;
}

export function useRealtimeSync(
  checklistId: string | undefined,
  callbacks: RealtimeCallbacks
) {
  useEffect(() => {
    if (!checklistId) return;

    console.log('Setting up real-time subscriptions for checklist:', checklistId);

    // Subscribe to item changes
    const itemCreateSub = client.models.ChecklistItem.onCreate().subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        // Ignore if this was our own mutation
        if (wasRecentMutation('item', data.id)) {
          console.log('Ignoring own item create:', data.id);
          return;
        }

        console.log('Remote item created:', data.id);
        callbacks.onItemCreate?.(data);
      },
      error: (err) => console.error('Item create subscription error:', err),
    });

    const itemUpdateSub = client.models.ChecklistItem.onUpdate().subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        if (wasRecentMutation('item', data.id)) {
          console.log('Ignoring own item update:', data.id);
          return;
        }

        console.log('Remote item updated:', data.id);
        callbacks.onItemUpdate?.(data);
      },
      error: (err) => console.error('Item update subscription error:', err),
    });

    const itemDeleteSub = client.models.ChecklistItem.onDelete().subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        if (wasRecentMutation('item', data.id)) {
          console.log('Ignoring own item delete:', data.id);
          return;
        }

        console.log('Remote item deleted:', data.id);
        callbacks.onItemDelete?.(data.id);
      },
      error: (err) => console.error('Item delete subscription error:', err),
    });

    // Subscribe to section changes
    const sectionCreateSub = client.models.ChecklistSection.onCreate({
      filter: { checklistId: { eq: checklistId } },
    }).subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        if (wasRecentMutation('section', data.id)) {
          console.log('Ignoring own section create:', data.id);
          return;
        }

        console.log('Remote section created:', data.id);
        callbacks.onSectionCreate?.(data);
      },
      error: (err) => console.error('Section create subscription error:', err),
    });

    const sectionUpdateSub = client.models.ChecklistSection.onUpdate({
      filter: { checklistId: { eq: checklistId } },
    }).subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        if (wasRecentMutation('section', data.id)) {
          console.log('Ignoring own section update:', data.id);
          return;
        }

        console.log('Remote section updated:', data.id);
        callbacks.onSectionUpdate?.(data);
      },
      error: (err) => console.error('Section update subscription error:', err),
    });

    const sectionDeleteSub = client.models.ChecklistSection.onDelete({
      filter: { checklistId: { eq: checklistId } },
    }).subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        if (wasRecentMutation('section', data.id)) {
          console.log('Ignoring own section delete:', data.id);
          return;
        }

        console.log('Remote section deleted:', data.id);
        callbacks.onSectionDelete?.(data.id);
      },
      error: (err) => console.error('Section delete subscription error:', err),
    });

    // Subscribe to checklist metadata changes
    const checklistUpdateSub = client.models.Checklist.onUpdate({
      filter: { id: { eq: checklistId } },
    }).subscribe({
      next: (data) => {
        if (!data || !data.id) return;

        if (wasRecentMutation('checklist', data.id)) {
          console.log('Ignoring own checklist update:', data.id);
          return;
        }

        console.log('Remote checklist updated:', data.id);
        callbacks.onChecklistUpdate?.(data);
      },
      error: (err) => console.error('Checklist update subscription error:', err),
    });

    // Cleanup on unmount
    return () => {
      console.log('Cleaning up subscriptions for checklist:', checklistId);
      itemCreateSub.unsubscribe();
      itemUpdateSub.unsubscribe();
      itemDeleteSub.unsubscribe();
      sectionCreateSub.unsubscribe();
      sectionUpdateSub.unsubscribe();
      sectionDeleteSub.unsubscribe();
      checklistUpdateSub.unsubscribe();
    };
  }, [checklistId, callbacks]);
}
