import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LocalStorageManager, LocalChecklist } from '../utils/localStorage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { useParams, useNavigate } from 'react-router-dom';
import { useRealtimeSync, trackMutation } from '../hooks/useRealtimeSync';
import { ShareLinkManager } from '../utils/shareLinks';
import { ShareDialog } from './ShareDialog';

const client = generateClient<Schema>();

interface ChecklistViewProps {
  onBack: () => void;
  user: any;
}

export const ChecklistView: React.FC<ChecklistViewProps> = ({
  onBack,
  user,
}) => {
  const { checklistId } = useParams<{ checklistId: string }>();
  const navigate = useNavigate();

  // Redirect if no checklistId in URL
  if (!checklistId) {
    navigate('/checklists');
    return null;
  }

  const [checklist, setChecklist] = useState<LocalChecklist | null>(null);
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'items' | 'sections'>('items');
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [remoteUpdateIndicator, setRemoteUpdateIndicator] = useState<string | null>(null);
  const [recentlyUpdatedItems, setRecentlyUpdatedItems] = useState<Set<string>>(new Set());
  const [recentlyUpdatedSections, setRecentlyUpdatedSections] = useState<Set<string>>(new Set());
  const [checklistJustUpdated, setChecklistJustUpdated] = useState(false);

  // User permissions
  const [userRole, setUserRole] = useState<'OWNER' | 'EDITOR' | 'VIEWER' | null>(null);
  const [hasShare, setHasShare] = useState<boolean>(true); // Track if user has ChecklistShare (vs public template viewer)
  const hasShareRef = useRef<boolean>(true); // Ref for accessing in callbacks

  // Inline editing state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingChecklistTitle, setEditingChecklistTitle] = useState(false);
  const [editingChecklistDescription, setEditingChecklistDescription] = useState(false);

  // Checklist-level edits
  const [checklistTitle, setChecklistTitle] = useState('');
  const [checklistDescription, setChecklistDescription] = useState('');

  // Tag management (from ChecklistEditor)
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [showTagSuggestions, setShowTagSuggestions] = useState<Record<string, boolean>>({});

  // Auto-save status
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Debounce timers and rollback
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const [previousState, setPreviousState] = useState<LocalChecklist | null>(null);

  useEffect(() => {
    loadChecklist();
  }, [checklistId]);

  // Fetch user role for permissions (only when checklistId or user changes, NOT when checklist changes)
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!user || !checklistId) {
        setUserRole('OWNER'); // Local storage mode, user owns everything
        return;
      }

      try {
        const role = await ShareLinkManager.getUserRole(checklistId, user);
        console.log('Fetched user role:', role, 'for user:', user.username || user.userId);

        if (role) {
          setUserRole(role);
        } else {
          // No share found - check if user is the original author as fallback
          console.log('No share found, checking if user is author');
          const checklistResult = await client.models.Checklist.get({ id: checklistId });
          if (checklistResult.data) {
            const author = checklistResult.data.author;
            const isAuthor =
              author === user.userId ||
              author === user.username ||
              author === user.signInDetails?.loginId ||
              author === (user.attributes && user.attributes.email);

            console.log('Author check:', { author, userId: user.userId, username: user.username, isAuthor });
            setUserRole(isAuthor ? 'OWNER' : 'VIEWER');
          } else {
            setUserRole('VIEWER');
          }
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        setUserRole('VIEWER');
      }
    };

    fetchUserRole();
  }, [checklistId, user]); // Removed checklist dependency to prevent loop

  // Show temporary indicator when remote changes arrive
  const showRemoteUpdate = (message: string) => {
    setRemoteUpdateIndicator(message);
    setTimeout(() => setRemoteUpdateIndicator(null), 3000);
  };

  // Highlight a specific item that was updated
  const highlightItem = (itemId: string) => {
    setRecentlyUpdatedItems(prev => new Set(prev).add(itemId));
    setTimeout(() => {
      setRecentlyUpdatedItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }, 2000);
  };

  // Highlight a specific section that was updated
  const highlightSection = (sectionId: string) => {
    setRecentlyUpdatedSections(prev => new Set(prev).add(sectionId));
    setTimeout(() => {
      setRecentlyUpdatedSections(prev => {
        const newSet = new Set(prev);
        newSet.delete(sectionId);
        return newSet;
      });
    }, 2000);
  };

  // Highlight the checklist title
  const highlightChecklist = () => {
    setChecklistJustUpdated(true);
    setTimeout(() => setChecklistJustUpdated(false), 2000);
  };

  // Real-time sync with granular updates (no page reload)
  const realtimeCallbacks = useMemo(() => ({
    onItemCreate: (item: any) => {
      showRemoteUpdate('Item added');
      highlightItem(item.id);
      setChecklist(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map(section => {
            if (section.id === item.sectionId) {
              // Add the new item to the section
              const newItem = {
                id: item.id,
                title: item.title,
                description: item.description,
                order: item.order,
                // Public template viewers always see unchecked
                completed: hasShareRef.current ? item.completed : false,
                tags: item.tags || [],
              };
              return {
                ...section,
                items: [...section.items, newItem].sort((a, b) => a.order - b.order),
              };
            }
            return section;
          }),
        };
      });
    },

    onItemUpdate: (item: any) => {
      showRemoteUpdate('Item updated');
      highlightItem(item.id);
      setChecklist(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map(section => ({
            ...section,
            items: section.items.map(existingItem => {
              if (existingItem.id === item.id) {
                return {
                  ...existingItem,
                  title: item.title,
                  description: item.description,
                  order: item.order,
                  // Only update completed state if user has a share
                  completed: hasShareRef.current ? item.completed : existingItem.completed,
                  tags: item.tags || [],
                };
              }
              return existingItem;
            }).sort((a, b) => a.order - b.order), // Re-sort items after update
          })),
        };
      });

      // Update progress if completed state changed AND user has a share
      // (public template viewers don't see completion state updates)
      if (item.completed !== undefined && hasShareRef.current) {
        setProgress(prev => ({ ...prev, [item.id]: item.completed }));
      }
    },

    onItemDelete: (itemId: string) => {
      showRemoteUpdate('Item deleted');
      // Don't highlight deleted items, they're gone
      setChecklist(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map(section => ({
            ...section,
            items: section.items.filter(item => item.id !== itemId),
          })),
        };
      });

      // Remove from progress
      setProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[itemId];
        return newProgress;
      });
    },

    onSectionCreate: (section: any) => {
      showRemoteUpdate('Section added');
      highlightSection(section.id);
      setChecklist(prev => {
        if (!prev) return prev;
        const newSection = {
          id: section.id,
          title: section.title,
          order: section.order,
          items: [],
        };
        return {
          ...prev,
          sections: [...prev.sections, newSection].sort((a, b) => a.order - b.order),
        };
      });
    },

    onSectionUpdate: (section: any) => {
      showRemoteUpdate('Section updated');
      highlightSection(section.id);
      setChecklist(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map(existingSection => {
            if (existingSection.id === section.id) {
              return {
                ...existingSection,
                title: section.title,
                order: section.order,
              };
            }
            return existingSection;
          }).sort((a, b) => a.order - b.order),
        };
      });
    },

    onSectionDelete: (sectionId: string) => {
      showRemoteUpdate('Section deleted');
      // Don't highlight deleted sections, they're gone
      setChecklist(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.filter(section => section.id !== sectionId),
        };
      });
    },

    onChecklistUpdate: (updatedChecklist: any) => {
      showRemoteUpdate('List updated');
      highlightChecklist();
      setChecklist(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          title: updatedChecklist.title || prev.title,
          description: updatedChecklist.description !== undefined ? updatedChecklist.description : prev.description,
          isPublic: updatedChecklist.isPublic ?? prev.isPublic,
        };
      });

      // Update the local state variables for title and description
      if (updatedChecklist.title) {
        setChecklistTitle(updatedChecklist.title);
      }
      if (updatedChecklist.description !== undefined) {
        setChecklistDescription(updatedChecklist.description);
      }
    },
  }), []);

  useRealtimeSync(checklistId, realtimeCallbacks);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(timer => clearTimeout(timer));
    };
  }, []);

  // Track scroll position for "scroll to top" button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollToTop(window.scrollY > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const loadChecklist = async () => {
    setLoading(true);
    try {
      if (user) {
        // Load from Amplify
        const result = await client.models.Checklist.get({ id: checklistId });
        if (result.data) {
          // Load all sections with pagination
          let allSections: any[] = [];
          let sectionToken: string | null | undefined = undefined;

          do {
            const sectionsResult: any = await client.models.ChecklistSection.list({
              filter: { checklistId: { eq: checklistId } },
              nextToken: sectionToken as any,
            });
            allSections = allSections.concat(sectionsResult.data || []);
            sectionToken = sectionsResult.nextToken;
          } while (sectionToken);

          // Load all sections with their items
          const sectionsWithItems = await Promise.all(
            allSections.map(async (section) => {
              // Fetch all items with pagination support
              let allItems: any[] = [];
              let nextToken: string | null | undefined = undefined;

              do {
                const itemsResult: any = await client.models.ChecklistItem.list({
                  filter: { sectionId: { eq: section.id } },
                  limit: 1000,
                  nextToken: nextToken as any,
                });

                allItems = allItems.concat(itemsResult.data || []);
                nextToken = itemsResult.nextToken;
              } while (nextToken);

              return {
                id: section.id,
                title: section.title,
                order: section.order,
                items: allItems
                  .sort((a, b) => a.order - b.order)
                  .map(item => ({
                    id: item.id,
                    title: item.title,
                    description: item.description || '',
                    order: item.order,
                    completed: item.completed || false,
                    tags: (item.tags || []).filter((tag: any): tag is string => tag !== null)
                  }))
              };
            })
          );

          // Check if current user is the owner
          const author = result.data.author;
          const isOwner = author === user.userId ||
                         author === user.username ||
                         author === user.signInDetails?.loginId ||
                         author === (user.attributes && user.attributes.email);

          const checklistData: any = {
            id: result.data.id,
            title: result.data.title,
            description: result.data.description || '',
            isPublic: result.data.isPublic || false,
            createdAt: result.data.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sections: sectionsWithItems.sort((a, b) => a.order - b.order),
            progress: {},
            author: result.data.author // Preserve the author field
          };

          setChecklist(checklistData);
          setChecklistTitle(checklistData.title);
          setChecklistDescription(checklistData.description || '');

          // Update lastUsedAt timestamp (non-blocking)
          if (isOwner) {
            client.models.Checklist.update({
              id: checklistId,
              lastUsedAt: new Date().toISOString(),
            }).catch(error => {
              console.error('Error updating lastUsedAt:', error);
              // Don't fail the whole operation if this fails
            });
          }

          // Build progress from item completed fields
          // Check if user has a ChecklistShare (OWNER/EDITOR/VIEWER role)
          // If they do, show actual completion state
          // If they don't (viewing public template), show all as uncompleted
          let userHasShare = isOwner; // Owner always has access
          if (!userHasShare) {
            try {
              const shareResult = await client.models.ChecklistShare.get({
                checklistId: checklistId,
                userId: user.username || user.userId,
              });
              userHasShare = !!shareResult.data;
            } catch (error) {
              // No share found
              userHasShare = false;
            }
          }
          setHasShare(userHasShare);
          hasShareRef.current = userHasShare;

          const userProgress: Record<string, boolean> = {};
          sectionsWithItems.forEach(section => {
            section.items.forEach(item => {
              // If user has a share (OWNER/EDITOR/VIEWER), show actual state
              // Otherwise (public template), show unchecked
              userProgress[item.id] = userHasShare ? (item.completed || false) : false;
            });
          });

          setProgress(userProgress);
        }
      } else {
        // Load from local storage
        const localChecklist = LocalStorageManager.getChecklist(checklistId);
        if (localChecklist) {
          setChecklist(localChecklist);
          setChecklistTitle(localChecklist.title);
          setChecklistDescription(localChecklist.description || '');
          const localProgress = LocalStorageManager.getProgress(checklistId);
          setProgress(localProgress);
        }
      }
    } catch (error) {
      console.error('Error loading checklist:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = async (itemId: string) => {
    const newCompleted = !progress[itemId];
    const newProgress = { ...progress, [itemId]: newCompleted };

    setProgress(newProgress);

    // Check if all items are now completed
    if (checklist) {
      const allItemIds = new Set<string>();
      checklist.sections.forEach(section => {
        section.items.forEach(item => {
          allItemIds.add(item.id);
        });
      });

      const allCompleted = Array.from(allItemIds).every(id => newProgress[id] === true);
      if (allCompleted && allItemIds.size > 0) {
        setShowCelebration(true);
      }
    }

    if (user) {
      // Update item's completed field in Amplify
      try {
        trackMutation('item', itemId);
        await client.models.ChecklistItem.update({
          id: itemId,
          completed: newCompleted
        });
      } catch (error) {
        console.error('Error updating item:', error);
      }
    } else {
      // Update progress in local storage
      LocalStorageManager.updateProgress(checklistId, itemId, newCompleted);
    }
  };

  const checkAllInSection = async (sectionId: string, visibleItems: any[]) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    if (!section || visibleItems.length === 0) return;

    // Determine if all VISIBLE items in this section are already completed
    const allVisibleItemsCompleted = visibleItems.every(item => progress[item.id] === true);
    const newCompletedState = !allVisibleItemsCompleted;

    // Create new progress with only VISIBLE items in this section toggled
    const newProgress = { ...progress };
    visibleItems.forEach(item => {
      newProgress[item.id] = newCompletedState;
    });

    setProgress(newProgress);

    // Check if all items are now completed for celebration
    const allItemIds = new Set<string>();
    checklist.sections.forEach(section => {
      section.items.forEach(item => {
        allItemIds.add(item.id);
      });
    });

    const allCompleted = Array.from(allItemIds).every(id => newProgress[id] === true);
    if (allCompleted && allItemIds.size > 0) {
      setShowCelebration(true);
    }

    if (user) {
      // Batch update all items in Amplify using Promise.all
      try {
        await Promise.all(
          section.items.map(item =>
            client.models.ChecklistItem.update({
              id: item.id,
              completed: newCompletedState
            })
          )
        );
      } catch (error) {
        console.error('Error updating items:', error);
      }
    } else {
      // Update all items in local storage
      section.items.forEach(item => {
        LocalStorageManager.updateProgress(checklistId, item.id, newCompletedState);
      });
    }
  };

  const getCompletionStats = () => {
    if (!checklist) return { completed: 0, total: 0 };

    // Get all item IDs from the checklist
    const allItemIds = new Set<string>();
    checklist.sections.forEach(section => {
      section.items.forEach(item => {
        allItemIds.add(item.id);
      });
    });

    const total = allItemIds.size;

    // Only count items that exist in the checklist and are marked as completed
    const completed = Array.from(allItemIds).filter(itemId => progress[itemId] === true).length;

    return { completed, total };
  };

  const getCompletionPercentage = () => {
    const { completed, total } = getCompletionStats();
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  };

  const getAllTags = (): string[] => {
    if (!checklist) return [];
    const allTags = new Set<string>();
    checklist.sections.forEach(section => {
      section.items.forEach(item => {
        if (item.tags) {
          item.tags.forEach(tag => allTags.add(tag));
        }
      });
    });
    return Array.from(allTags).sort();
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this checklist?')) {
      return;
    }

    try {
      if (user) {
        // Delete from Amplify - fetch all sections with pagination
        let allSections: any[] = [];
        let sectionToken: string | null | undefined = undefined;

        do {
          const sectionsResult: any = await client.models.ChecklistSection.list({
            filter: { checklistId: { eq: checklistId } },
            nextToken: sectionToken as any,
          });
          allSections = allSections.concat(sectionsResult.data || []);
          sectionToken = sectionsResult.nextToken;
        } while (sectionToken);

        // Delete all sections and items in parallel
        await Promise.all(
          allSections.map(async (section) => {
            // Fetch all items with pagination
            let allItems: any[] = [];
            let nextToken: string | null | undefined = undefined;

            do {
              const itemsResult: any = await client.models.ChecklistItem.list({
                filter: { sectionId: { eq: section.id } },
                nextToken: nextToken as any,
              });
              allItems = allItems.concat(itemsResult.data || []);
              nextToken = itemsResult.nextToken;
            } while (nextToken);

            // Delete all items in this section in parallel
            await Promise.all(
              allItems.map(item =>
                client.models.ChecklistItem.delete({ id: item.id })
              )
            );

            // Then delete the section
            await client.models.ChecklistSection.delete({ id: section.id });
          })
        );

        await client.models.Checklist.delete({ id: checklistId });
      } else {
        LocalStorageManager.deleteChecklist(checklistId);
      }

      onBack();
    } catch (error) {
      console.error('Error deleting checklist:', error);
      alert('Error deleting checklist. Please try again.');
    }
  };

  // Auto-save System
  const debouncedSave = useCallback((
    saveKey: string,
    saveFunction: () => Promise<void>,
    delay: number = 500
  ) => {
    // Clear existing timer for this key
    if (debounceTimers.current[saveKey]) {
      clearTimeout(debounceTimers.current[saveKey]);
    }

    // Set new timer
    debounceTimers.current[saveKey] = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveFunction();
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000); // Show "saved" for 2s
      } catch (error) {
        console.error('Save error:', error);
        setSaveStatus('error');
        setSaveError((error as Error).message);
        // Rollback logic
        if (previousState) {
          setChecklist(previousState);
          alert('Changes could not be saved and have been reverted.');
        }
      }
    }, delay);
  }, [previousState]);

  // Checklist-level Updates
  const updateChecklistTitle = async (newTitle: string) => {
    if (!checklist) return;

    // Optimistic update
    setPreviousState(checklist);
    setChecklist({ ...checklist, title: newTitle });
    setChecklistTitle(newTitle);

    // Debounced save
    debouncedSave('checklist-title', async () => {
      if (user) {
        trackMutation('checklist', checklistId);
        await client.models.Checklist.update({
          id: checklistId,
          title: newTitle.trim()
        });
      } else{
        const updated = { ...checklist, title: newTitle.trim() };
        LocalStorageManager.saveChecklist(updated);
      }
    });
  };

  const updateChecklistDescription = async (newDescription: string) => {
    if (!checklist) return;

    // Optimistic update
    setPreviousState(checklist);
    setChecklist({ ...checklist, description: newDescription });
    setChecklistDescription(newDescription);

    // Debounced save
    debouncedSave('checklist-description', async () => {
      if (user) {
        trackMutation('checklist', checklistId);
        await client.models.Checklist.update({
          id: checklistId,
          description: newDescription.trim()
        });
      } else{
        const updated = { ...checklist, description: newDescription.trim() };
        LocalStorageManager.saveChecklist(updated);
      }
    });
  };

  // Section CRUD
  const addSection = async () => {
    if (!checklist) return;

    const newSection = {
      id: LocalStorageManager.generateId(),
      title: `Section ${checklist.sections.length + 1}`,
      order: checklist.sections.length,
      items: []
    };

    // Optimistic update
    setPreviousState(checklist);
    const updatedChecklist = {
      ...checklist,
      sections: [...checklist.sections, newSection]
    };
    setChecklist(updatedChecklist);

    // Immediate save
    setSaveStatus('saving');
    try {
      if (user) {
        // Use our generated ID so it matches what's in the UI
        trackMutation('section', newSection.id);
        await client.models.ChecklistSection.create({
          id: newSection.id,
          checklistId: checklistId,
          title: newSection.title,
          order: newSection.order
        });
      } else {
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);

      // Auto-focus the new section title
      setTimeout(() => {
        setEditingSectionId(newSection.id);
      }, 0);
    } catch (error) {
      console.error('Error adding section:', error);
      setSaveStatus('error');
      if (previousState) {
        setChecklist(previousState);
      }
    }
  };

  const updateSectionTitle = async (sectionId: string, newTitle: string) => {
    if (!checklist) return;

    // Optimistic update
    setPreviousState(checklist);
    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.map(s =>
        s.id === sectionId ? { ...s, title: newTitle } : s
      )
    };
    setChecklist(updatedChecklist);

    // Debounced save
    debouncedSave(`section-${sectionId}`, async () => {
      if (user) {
        trackMutation('section', sectionId);
        await client.models.ChecklistSection.update({
          id: sectionId,
          title: newTitle.trim()
        });
      } else{
        const updated = {
          ...checklist,
          sections: checklist.sections.map(s =>
            s.id === sectionId ? { ...s, title: newTitle.trim() } : s
          )
        };
        LocalStorageManager.saveChecklist(updated);
      }
    });
  };

  const deleteSection = async (sectionId: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    if (!section) return;

    // Confirm deletion
    const itemCount = section.items.length;
    const message = itemCount > 0
      ? `Delete "${section.title}" and its ${itemCount} item(s)?`
      : `Delete section "${section.title}"?`;

    if (!window.confirm(message)) return;

    // Optimistic update
    setPreviousState(checklist);
    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.filter(s => s.id !== sectionId)
    };
    setChecklist(updatedChecklist);

    // Immediate save
    setSaveStatus('saving');
    try {
      if (user) {
        // Delete all items first with pagination, then section
        let allItems: any[] = [];
        let nextToken: string | null | undefined = undefined;

        do {
          const itemsResult: any = await client.models.ChecklistItem.list({
            filter: { sectionId: { eq: sectionId } },
            nextToken: nextToken as any,
          });
          allItems = allItems.concat(itemsResult.data || []);
          nextToken = itemsResult.nextToken;
        } while (nextToken);

        await Promise.all(
          allItems.map(item =>
            client.models.ChecklistItem.delete({ id: item.id })
          )
        );

        trackMutation('section', sectionId);
        await client.models.ChecklistSection.delete({ id: sectionId });
      } else {
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Error deleting section:', error);
      setSaveStatus('error');
      if (previousState) {
        setChecklist(previousState);
      }
    }
  };

  // Item CRUD
  const addItem = async (sectionId: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    if (!section) return;

    const newItem = {
      id: LocalStorageManager.generateId(),
      title: '',
      description: '',
      order: section.items.length,
      completed: false,
      tags: []
    };

    // Optimistic update
    setPreviousState(checklist);
    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.map(s =>
        s.id === sectionId
          ? { ...s, items: [...s.items, newItem] }
          : s
      )
    };
    setChecklist(updatedChecklist);

    // Immediate save
    setSaveStatus('saving');
    try {
      if (user) {
        // Use our generated ID so it matches what's in the UI
        trackMutation('item', newItem.id);
        await client.models.ChecklistItem.create({
          id: newItem.id,
          sectionId: sectionId,
          title: newItem.title,
          description: newItem.description || '',
          order: newItem.order,
          completed: false,
          tags: []
        });
      } else {
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);

      // Auto-open edit mode for the new item
      setTimeout(() => {
        setEditingItemId(newItem.id);
      }, 0);
    } catch (error) {
      console.error('Error adding item:', error);
      setSaveStatus('error');
      if (previousState) {
        setChecklist(previousState);
      }
    }
  };

  const updateItem = async (
    sectionId: string,
    itemId: string,
    updates: any
  ) => {
    if (!checklist) return;

    // Find current item to preserve completed state
    const section = checklist.sections.find(s => s.id === sectionId);
    const currentItem = section?.items.find(i => i.id === itemId);
    if (!currentItem) return;

    // Optimistic update
    setPreviousState(checklist);
    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.map(s =>
        s.id === sectionId
          ? {
              ...s,
              items: s.items.map(i =>
                i.id === itemId
                  ? { ...i, ...updates }
                  : i
              )
            }
          : s
      )
    };
    setChecklist(updatedChecklist);

    // Debounced save
    debouncedSave(`item-${itemId}`, async () => {
      if (user) {
        // CRITICAL: Preserve completed field!
        trackMutation('item', itemId);
        await client.models.ChecklistItem.update({
          id: itemId,
          title: updates.title !== undefined ? updates.title.trim() : currentItem.title,
          description: updates.description !== undefined ? updates.description.trim() : (currentItem.description || ''),
          tags: updates.tags || currentItem.tags || [],
          // completed is intentionally NOT updated here - only toggleItem updates it
        });
      } else{
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
    });
  };

  const deleteItem = async (sectionId: string, itemId: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);

    if (!window.confirm(`Delete "${item?.title || 'this item'}"?`)) return;

    // Optimistic update
    setPreviousState(checklist);
    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.map(s =>
        s.id === sectionId
          ? { ...s, items: s.items.filter(i => i.id !== itemId) }
          : s
      )
    };
    setChecklist(updatedChecklist);

    // Remove from progress tracking
    const newProgress = { ...progress };
    delete newProgress[itemId];
    setProgress(newProgress);

    // Immediate save
    setSaveStatus('saving');
    try {
      if (user) {
        trackMutation('item', itemId);
        await client.models.ChecklistItem.delete({ id: itemId });
      } else{
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Error deleting item:', error);
      setSaveStatus('error');
      if (previousState) {
        setChecklist(previousState);
      }
    }
  };

  const moveItemUp = async (sectionId: string, itemId: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    if (!section) return;

    const itemIndex = section.items.findIndex(i => i.id === itemId);
    if (itemIndex <= 0) return; // Already at top

    // Optimistic update
    setPreviousState(checklist);
    const updatedItems = [...section.items];
    [updatedItems[itemIndex - 1], updatedItems[itemIndex]] =
      [updatedItems[itemIndex], updatedItems[itemIndex - 1]];

    // Update order values
    updatedItems.forEach((item, index) => {
      item.order = index;
    });

    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.map(s =>
        s.id === sectionId ? { ...s, items: updatedItems } : s
      )
    };
    setChecklist(updatedChecklist);

    // Immediate save (structural change)
    setSaveStatus('saving');
    try {
      if (user) {
        // Batch update order for affected items
        await Promise.all(
          updatedItems.slice(itemIndex - 1, itemIndex + 1).map(item =>
            client.models.ChecklistItem.update({
              id: item.id,
              order: item.order
            })
          )
        );
      } else {
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Error moving item:', error);
      setSaveStatus('error');
      if (previousState) {
        setChecklist(previousState);
      }
    }
  };

  const moveItemDown = async (sectionId: string, itemId: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    if (!section) return;

    const itemIndex = section.items.findIndex(i => i.id === itemId);
    if (itemIndex < 0 || itemIndex >= section.items.length - 1) return; // Already at bottom

    // Optimistic update
    setPreviousState(checklist);
    const updatedItems = [...section.items];
    [updatedItems[itemIndex], updatedItems[itemIndex + 1]] =
      [updatedItems[itemIndex + 1], updatedItems[itemIndex]];

    // Update order values
    updatedItems.forEach((item, index) => {
      item.order = index;
    });

    const updatedChecklist = {
      ...checklist,
      sections: checklist.sections.map(s =>
        s.id === sectionId ? { ...s, items: updatedItems } : s
      )
    };
    setChecklist(updatedChecklist);

    // Immediate save (structural change)
    setSaveStatus('saving');
    try {
      if (user) {
        // Batch update order for affected items
        await Promise.all(
          updatedItems.slice(itemIndex, itemIndex + 2).map(item =>
            client.models.ChecklistItem.update({
              id: item.id,
              order: item.order
            })
          )
        );
      } else {
        LocalStorageManager.saveChecklist(updatedChecklist);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Error moving item:', error);
      setSaveStatus('error');
      if (previousState) {
        setChecklist(previousState);
      }
    }
  };

  // Tag Management (from ChecklistEditor)
  const addTag = async (sectionId: string, itemId: string, tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag || !checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);
    if (!item) return;

    const currentTags = item.tags || [];
    if (currentTags.includes(trimmedTag)) return; // Already exists

    await updateItem(sectionId, itemId, {
      tags: [...currentTags, trimmedTag]
    });

    setTagInput({ ...tagInput, [itemId]: '' });
    setShowTagSuggestions({ ...showTagSuggestions, [itemId]: false });
  };

  const removeTag = async (sectionId: string, itemId: string, tagToRemove: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    const item = section?.items.find(i => i.id === itemId);
    if (!item) return;

    const updatedTags = (item.tags || []).filter(tag => tag !== tagToRemove);
    await updateItem(sectionId, itemId, { tags: updatedTags });
  };

  const getTagSuggestions = (itemId: string): string[] => {
    const input = (tagInput[itemId] || '').toLowerCase();
    if (!input || !checklist) return [];

    const section = checklist.sections.find(s => s.items.some(i => i.id === itemId));
    if (!section) return [];

    const item = section.items.find(i => i.id === itemId);
    const currentTags = item?.tags || [];

    const allTags = getAllTags();
    return allTags
      .filter(tag => !currentTags.includes(tag) && tag.toLowerCase().includes(input))
      .slice(0, 5);
  };

  const handleTagInputChange = (itemId: string, value: string) => {
    setTagInput({ ...tagInput, [itemId]: value });
    setShowTagSuggestions({ ...showTagSuggestions, [itemId]: value.length > 0 });
  };

  const handleTagInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    sectionId: string,
    itemId: string
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = tagInput[itemId] || '';
      addTag(sectionId, itemId, tag);
    }
  };

  // Keyboard Shortcuts
  const handleItemKeyDown = (
    e: React.KeyboardEvent,
    sectionId: string,
    itemId: string
  ) => {
    if (e.key === 'Escape') {
      setEditingItemId(null);
    } else if (e.key === 'Enter' && (e.target as HTMLInputElement).tagName === 'INPUT') {
      e.preventDefault();
      // Validate current item has a title
      const section = checklist?.sections.find(s => s.id === sectionId);
      const item = section?.items.find(i => i.id === itemId);
      if (item && item.title.trim()) {
        addItem(sectionId); // Add new item and auto-open in edit mode
      } else {
        alert('Please enter a title for this item');
      }
    }
    // Shift+Enter in textarea allows newlines
  };

  const handleSectionTitleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Escape') {
      setEditingSectionId(null);
    }
  };

  // Auto-resize textarea
  const autoResizeTextarea = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  };

  const isOwner = () => {
    if (!checklist) return false;
    if (!user) return true; // Local storage, user owns everything

    // For Amplify, check if user created it
    const author = (checklist as any).author;

    // If there's no author field, assume it's not owned by the current user
    if (!author) return false;

    // Check various user identifier fields
    return (
      author === user.userId ||
      author === user.username ||
      author === user.signInDetails?.loginId ||
      author === (user.attributes && user.attributes.email)
    );
  };

  // Permission helpers
  const canEdit = () => userRole === 'OWNER' || userRole === 'EDITOR';
  const canManageSharing = () => userRole === 'OWNER';
  const canDelete = () => userRole === 'OWNER';
  const canCheckItems = () => canEdit();

  const handleLeaveSharedList = () => {
    navigate('/checklists');
  };

  const handleClone = async () => {
    if (!checklist) return;

    // Show loading state
    setLoading(true);

    try {
      // Clone checklist with NEW IDs for everything and current user as author
      const newChecklistId = LocalStorageManager.generateId();
      const newAuthor = user ? (user.username || user.userId) : undefined;

      const clonedChecklist: LocalChecklist = {
        ...checklist,
        id: newChecklistId,
        title: `${checklist.title} (Copy)`,
        isPublic: false, // Clones are private by default
        author: newAuthor, // Set current user as author
        createdAt: new Date().toISOString(),
        progress: {},
        sections: checklist.sections.map(section => ({
          ...section,
          id: LocalStorageManager.generateId(), // Generate NEW section ID
          items: section.items.map(item => ({
            ...item,
            id: LocalStorageManager.generateId(), // Generate NEW item ID
            completed: false, // Reset all items to uncompleted
          }))
        }))
      };

      if (user) {
        // Save to Amplify with current user as author
        const newChecklist = await client.models.Checklist.create({
          id: clonedChecklist.id, // Use our generated ID
          title: clonedChecklist.title,
          description: clonedChecklist.description || '',
          isPublic: false,
          author: newAuthor, // Current user is now the owner
          useCount: 0,
        });

        if (!newChecklist.data) {
          throw new Error('Failed to clone checklist');
        }

        // Create OWNER share for the new checklist
        const userEmail = user.attributes?.email || user.signInDetails?.loginId || newAuthor;
        await client.models.ChecklistShare.create({
          checklistId: newChecklist.data.id,
          userId: newAuthor!,
          email: userEmail,
          role: 'OWNER',
          sharedBy: newAuthor!,
          createdAt: new Date().toISOString(),
        });

        // Clone sections and items (batched for performance)
        for (const section of clonedChecklist.sections) {
          const newSection = await client.models.ChecklistSection.create({
            id: section.id, // Use our generated ID
            checklistId: newChecklist.data.id,
            title: section.title,
            order: section.order,
          });

          if (newSection.data && section.items.length > 0) {
            // Create all items in parallel with our generated IDs
            await Promise.all(
              section.items.map(item =>
                client.models.ChecklistItem.create({
                  id: item.id, // Use our generated ID
                  sectionId: section.id,
                  title: item.title,
                  description: item.description || '',
                  order: item.order,
                  completed: false,
                  tags: item.tags || [],
                })
              )
            );
          }
        }

        // Increment use count for the template (if it's someone else's)
        if (!isOwner() && checklist.isPublic) {
          try {
            await client.models.Checklist.update({
              id: checklistId,
              useCount: ((checklist as any).useCount || 0) + 1,
              lastUsedAt: new Date().toISOString(),
            });
          } catch (error) {
            console.error('Error updating use count:', error);
            // Don't fail the whole operation if this fails
          }
        }

        setLoading(false);
        alert('Added to your lists!');
        onBack();
      } else {
        // Save to local storage
        LocalStorageManager.saveChecklist(clonedChecklist);
        setLoading(false);
        alert('Added to your lists!');
        onBack();
      }
    } catch (error) {
      console.error('Error copying checklist:', error);
      setLoading(false);
      alert('Error copying checklist. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading checklist...</p>
      </div>
    );
  }

  if (!checklist) {
    return (
      <div className="error-state">
        <h2>Checklist not found</h2>
        <p>The checklist you're looking for doesn't exist or has been removed.</p>
        <button onClick={onBack} className="back-button">
          Back to Lists
        </button>
      </div>
    );
  }

  const { completed, total } = getCompletionStats();
  const percentage = getCompletionPercentage();

  return (
    <div className="checklist-view">
      {remoteUpdateIndicator && (
        <div className="remote-update-indicator">
          <span className="material-symbols-outlined">person</span>
          {remoteUpdateIndicator}
        </div>
      )}
      <div className="view-header">
        <div className="checklist-info">
          <div className="title-actions-row">
            {canEdit() ? (
              editingChecklistTitle ? (
                <input
                  type="text"
                  value={checklistTitle}
                  onChange={(e) => {
                    setChecklistTitle(e.target.value);
                    updateChecklistTitle(e.target.value);
                  }}
                  onBlur={() => setEditingChecklistTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingChecklistTitle(false);
                  }}
                  className="checklist-title-input"
                  autoFocus
                />
              ) : (
                <h1 onClick={() => setEditingChecklistTitle(true)} className={`editable-text ${checklistJustUpdated ? 'remote-updated' : ''}`}>
                  {checklist.title}
                  {checklist.isPublic && (
                    <span
                      className="privacy-icon"
                      title="Shared as public template"
                    >
                      <span className="material-symbols-outlined">public</span>
                    </span>
                  )}
                  {(checklist as any).isPrivatelyShared && (
                    <span
                      className="privacy-icon"
                      title="Shared with others"
                    >
                      <span className="material-symbols-outlined">group</span>
                    </span>
                  )}
                </h1>
              )
            ) : (
              <h1 className={checklistJustUpdated ? 'remote-updated' : ''}>
                {checklist.title}
                {checklist.isPublic && (
                  <span
                    className="privacy-icon"
                    title="Shared as public template"
                  >
                    <span className="material-symbols-outlined">public</span>
                  </span>
                )}
                {(checklist as any).isPrivatelyShared && (
                  <span
                    className="privacy-icon"
                    title="Shared with others"
                  >
                    <span className="material-symbols-outlined">group</span>
                  </span>
                )}
              </h1>
            )}
            <div className="view-actions">
              {canEdit() && saveStatus !== 'idle' && (
                <div className={`save-status save-status-${saveStatus}`}>
                  {saveStatus === 'saving' && '💾 Saving...'}
                  {saveStatus === 'saved' && '✓ Saved'}
                  {saveStatus === 'error' && `⚠ Error: ${saveError}`}
                </div>
              )}
              {canManageSharing() && (
                <button onClick={() => setShowShareDialog(true)} className="share-button" title="Share this list">
                  <span className="material-symbols-outlined">share</span>
                </button>
              )}
              {canDelete() && (
                <button onClick={handleDelete} className="delete-button" title="Delete">
                  <span className="material-symbols-outlined">delete</span>
                </button>
              )}
              {!canEdit() && !hasShare && checklist.isPublic && (
                <button onClick={handleClone} className="clone-button" title="Copy this checklist to your lists">
                  Use this List
                </button>
              )}
            </div>
          </div>
          {userRole === 'VIEWER' && (
            <div className="role-notice viewer-notice">
              <span className="material-symbols-outlined">visibility</span>
              You have view-only access to this list
            </div>
          )}
          {userRole === 'EDITOR' && (
            <div className="role-notice editor-notice">
              <span className="material-symbols-outlined">edit</span>
              You can edit this list but cannot manage sharing
            </div>
          )}
          {canEdit() ? (
            editingChecklistDescription ? (
              <textarea
                value={checklistDescription}
                onChange={(e) => {
                  setChecklistDescription(e.target.value);
                  updateChecklistDescription(e.target.value);
                }}
                onBlur={() => setEditingChecklistDescription(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingChecklistDescription(false);
                }}
                className="checklist-description-input"
                placeholder="Add a description..."
                autoFocus
                rows={2}
              />
            ) : (
              <p
                onClick={() => setEditingChecklistDescription(true)}
                className={`checklist-description editable-text ${!checklistDescription ? 'placeholder' : ''}`}
              >
                {checklistDescription || 'Add a description...'}
              </p>
            )
          ) : (
            checklist.description && (
              <p className="checklist-description">{checklist.description}</p>
            )
          )}
        </div>
      </div>

      <div className="progress-section">
        <div className="progress-bar-container">
          <div className="progress-text">
            {completed} of {total} completed ({percentage}%)
          </div>
          {getAllTags().length > 0 && (
            <div className="tag-filter-container">
              <span className="tag-filter-label">Filter by tags:</span>
              <div className="tag-filter-pills">
                {getAllTags().map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`tag-filter-pill ${selectedTags.includes(tag) ? 'active' : ''}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="progress-controls">
            <div className="search-container">
              <input
                type="text"
                placeholder={searchMode === 'items' ? 'Search items...' : 'Search sections...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              <select
                value={searchMode}
                onChange={(e) => setSearchMode(e.target.value as 'items' | 'sections')}
                className="search-mode-select"
                title="Search mode"
              >
                <option value="items">Items</option>
                <option value="sections">Sections</option>
              </select>
            </div>
            <label className="hide-completed-label">
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
              />
              Hide completed
            </label>
          </div>
        </div>
      </div>

      {(() => {
        // Check if we're actively filtering
        const isActivelyFiltering = selectedTags.length > 0 || searchQuery.trim().length > 0;

        // Calculate visible items for each section
        const sectionsWithVisibility = checklist.sections.map((section) => {
          // When searching by section name, check if section matches
          let sectionMatches = false;
          if (searchQuery && searchMode === 'sections') {
            const query = searchQuery.toLowerCase();
            sectionMatches = section.title.toLowerCase().includes(query);
          }

          const visibleItems = section.items.filter(item => {
            // Filter by completion status
            if (hideCompleted && progress[item.id]) return false;

            // Filter by tags (AND logic - item must have ALL selected tags)
            if (selectedTags.length > 0) {
              const itemTags = item.tags || [];
              const hasAllTags = selectedTags.every(tag => itemTags.includes(tag));
              if (!hasAllTags) return false;
            }

            // Filter by search query
            if (searchQuery) {
              if (searchMode === 'sections') {
                // In section mode, show all items if section matches
                return sectionMatches;
              } else {
                // In items mode, search item title/description
                const query = searchQuery.toLowerCase();
                return (
                  item.title.toLowerCase().includes(query) ||
                  item.description?.toLowerCase().includes(query)
                );
              }
            }

            return true;
          });

          return { section, visibleItems };
        });

        // Count hidden sections when actively filtering
        const hiddenSectionsCount = isActivelyFiltering
          ? sectionsWithVisibility.filter(({ visibleItems }) => visibleItems.length === 0).length
          : 0;

        return (
          <>
            {isActivelyFiltering && hiddenSectionsCount > 0 && (
              <div className="hidden-sections-indicator">
                {hiddenSectionsCount} section{hiddenSectionsCount !== 1 ? 's' : ''} hidden
              </div>
            )}

            <div className="checklist-sections">
              {sectionsWithVisibility.map(({ section, visibleItems }) => {
                // Hide sections with no visible items when actively filtering
                // For editors/owners not filtering, show all sections (so they can add items)
                if (visibleItems.length === 0) {
                  if (isActivelyFiltering) return null;
                  if (!canEdit()) return null;
                }

          // Calculate section progress based on VISIBLE items
          const completedVisibleItems = visibleItems.filter(item => progress[item.id] === true).length;
          const totalVisibleItems = visibleItems.length;
          const sectionProgressPercent = totalVisibleItems > 0 ? (completedVisibleItems / totalVisibleItems) * 100 : 0;
          const allVisibleItemsCompleted = visibleItems.length > 0 && visibleItems.every(item => progress[item.id] === true);

          return (
          <div key={section.id} className={`section ${recentlyUpdatedSections.has(section.id) ? 'remote-updated' : ''}`}>
            {canEdit() ? (
              <div className="section-header-editable">
                {editingSectionId === section.id ? (
                  <input
                    type="text"
                    value={section.title}
                    onChange={(e) => updateSectionTitle(section.id, e.target.value)}
                    onBlur={() => setEditingSectionId(null)}
                    onKeyDown={(e) => handleSectionTitleKeyDown(e)}
                    className="section-title-input-inline"
                    data-section-id={section.id}
                    autoFocus
                  />
                ) : (
                  <div className="section-title-with-progress">
                    <h2
                      onClick={() => setEditingSectionId(section.id)}
                      className="section-title-editable"
                    >
                      {section.title}
                      {totalVisibleItems > 0 && (
                        <span className="section-progress-text">
                          ({completedVisibleItems}/{totalVisibleItems})
                        </span>
                      )}
                    </h2>
                    {totalVisibleItems > 0 && (
                      <div className="section-progress-bar">
                        <div
                          className="section-progress-fill"
                          style={{ width: `${sectionProgressPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="section-actions">
                  {visibleItems.length > 0 && (
                    <button
                      onClick={() => checkAllInSection(section.id, visibleItems)}
                      className="check-all-button"
                      title={allVisibleItemsCompleted ? "Uncheck all visible items" : "Check all visible items"}
                    >
                      {allVisibleItemsCompleted ? '✗ Uncheck all' : '✓ Check all'}
                    </button>
                  )}
                  <button
                    onClick={() => addItem(section.id)}
                    className="add-item-inline-button"
                    title="Add item"
                  >
                    <span className="material-symbols-outlined">add</span>
                  </button>
                  <button
                    onClick={() => deleteSection(section.id)}
                    className="delete-section-button"
                    title="Delete section"
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="section-header-view">
                <div className="section-title-with-progress">
                  <h2 className="section-title">
                    {section.title}
                    {totalVisibleItems > 0 && (
                      <span className="section-progress-text">
                        ({completedVisibleItems}/{totalVisibleItems})
                      </span>
                    )}
                  </h2>
                  {totalVisibleItems > 0 && (
                    <div className="section-progress-bar">
                      <div
                        className="section-progress-fill"
                        style={{ width: `${sectionProgressPercent}%` }}
                      />
                    </div>
                  )}
                </div>
                {visibleItems.length > 0 && (
                  <button
                    onClick={() => checkAllInSection(section.id, visibleItems)}
                    className="check-all-button"
                    title={allVisibleItemsCompleted ? "Uncheck all visible items" : "Check all visible items"}
                  >
                    {allVisibleItemsCompleted ? '✗ Uncheck all' : '✓ Check all'}
                  </button>
                )}
              </div>
            )}
            <div className="section-items">
              {visibleItems.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className={`checklist-item ${progress[item.id] ? 'completed' : ''} ${!canEdit() ? 'disabled' : ''} ${canEdit() ? 'editable' : ''} ${recentlyUpdatedItems.has(item.id) ? 'remote-updated' : ''}`}
                >
                  <span
                    className="item-checkbox"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canCheckItems()) toggleItem(item.id);
                    }}
                    style={{ cursor: canCheckItems() ? 'pointer' : 'not-allowed' }}
                  >
                    {progress[item.id] ? '☑' : '☐'}
                  </span>

                  {canEdit() ? (
                    editingItemId === item.id ? (
                      // EDIT MODE - Full editing interface
                      <div className="item-content-editable" onClick={(e) => e.stopPropagation()}>
                        {/* Title input */}
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateItem(section.id, item.id, { title: e.target.value })}
                          onKeyDown={(e) => handleItemKeyDown(e, section.id, item.id)}
                          className="item-title-input-inline"
                          placeholder="Item title"
                          autoFocus
                        />

                        {/* Description input */}
                        <textarea
                          value={item.description || ''}
                          onChange={(e) => {
                            updateItem(section.id, item.id, { description: e.target.value });
                            autoResizeTextarea(e);
                          }}
                          onKeyDown={(e) => handleItemKeyDown(e, section.id, item.id)}
                          className="item-description-input-inline"
                          placeholder="Add description..."
                        />

                        {/* Tags editing */}
                        <div className="item-tags-editable">
                          {item.tags && item.tags.length > 0 && (
                            <div className="item-tags">
                              {item.tags.map(tag => (
                                <span key={tag} className="tag-pill-editable">
                                  {tag}
                                  <button
                                    onClick={() => removeTag(section.id, item.id, tag)}
                                    className="tag-remove"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="tag-input-wrapper">
                            <input
                              type="text"
                              value={tagInput[item.id] || ''}
                              onChange={(e) => handleTagInputChange(item.id, e.target.value)}
                              onKeyDown={(e) => handleTagInputKeyDown(e, section.id, item.id)}
                              onBlur={() => setTimeout(() =>
                                setShowTagSuggestions({ ...showTagSuggestions, [item.id]: false }), 200
                              )}
                              placeholder="Add tags (press enter to save)..."
                              className="tag-input-inline"
                            />
                            {showTagSuggestions[item.id] && getTagSuggestions(item.id).length > 0 && (
                              <div className="tag-suggestions">
                                {getTagSuggestions(item.id).map(suggestion => (
                                  <div
                                    key={suggestion}
                                    className="tag-suggestion"
                                    onClick={() => addTag(section.id, item.id, suggestion)}
                                  >
                                    {suggestion}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Done button */}
                        <button
                          onClick={() => setEditingItemId(null)}
                          className="done-editing-button"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      // VIEW MODE - Condensed display with edit button
                      <div className="item-content">
                        <div className="item-text-content">
                          <span className="item-title">{item.title}</span>
                          {item.description && (
                            <span className="item-description">({item.description})</span>
                          )}
                          {item.tags && item.tags.length > 0 && (
                            <div className="item-tags-view">
                              {item.tags.map(tag => (
                                <span key={tag} className="tag-pill-view">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="item-content">
                      <div className="item-text-content">
                        <span className="item-title">{item.title}</span>
                        {item.description && (
                          <span className="item-description">({item.description})</span>
                        )}
                      </div>
                      {item.tags && item.tags.length > 0 && (
                        <div className="item-tags-view">
                          {item.tags.map(tag => (
                            <span key={tag} className="tag-pill-view">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Item actions - editors and owners */}
                  {canEdit() && (
                    <div className="item-actions-inline" onClick={(e) => e.stopPropagation()}>
                      {editingItemId !== item.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItemId(item.id);
                          }}
                          className="edit-item-button"
                          title="Edit"
                        >
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveItemUp(section.id, item.id);
                        }}
                        disabled={itemIndex === 0}
                        className="move-item-button"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          moveItemDown(section.id, item.id);
                        }}
                        disabled={itemIndex === visibleItems.length - 1}
                        className="move-item-button"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteItem(section.id, item.id);
                        }}
                        className="delete-item-button"
                        title="Delete"
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Add Item button - editors and owners */}
              {canEdit() && (
                <button
                  onClick={() => addItem(section.id)}
                  className="add-item-button-inline"
                >
                  + Add Item
                </button>
              )}
            </div>
          </div>
        );
              })}

              {/* Add Section button - editors and owners */}
              {canEdit() && (
                <button
                  onClick={addSection}
                  className="add-section-button-inline"
                >
                  + Add Section
                </button>
              )}
            </div>
          </>
        );
      })()}

      {showShareDialog && checklist && (
        <ShareDialog
          checklistId={checklistId!}
          checklistTitle={checklist.title}
          isPublic={checklist.isPublic || false}
          userRole={userRole}
          user={user}
          onClose={() => setShowShareDialog(false)}
          onLeave={handleLeaveSharedList}
        />
      )}

      {showCelebration && percentage === 100 && (
        <div className="completion-celebration" onClick={() => setShowCelebration(false)}>
          <div className="celebration-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-celebration" onClick={() => setShowCelebration(false)}>✕</button>
            <span className="celebration-emoji">🎉</span>
            <h2>Congratulations!</h2>
            <p>You've completed this checklist!</p>
          </div>
        </div>
      )}

      {showScrollToTop && (
        <button
          className="scroll-to-top"
          onClick={scrollToTop}
          title="Scroll to top"
        >
          <span className="material-symbols-outlined">arrow_upward</span>
        </button>
      )}
    </div>
  );
};