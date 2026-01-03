import React, { useState, useEffect } from 'react';
import { LocalStorageManager, LocalChecklist } from '../utils/localStorage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

interface ChecklistViewProps {
  checklistId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
  onClone?: (checklist: LocalChecklist) => void;
  user: any;
}

export const ChecklistView: React.FC<ChecklistViewProps> = ({
  checklistId,
  onBack,
  onEdit,
  user,
}) => {
  const [checklist, setChecklist] = useState<LocalChecklist | null>(null);
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    loadChecklist();
  }, [checklistId]);

  const loadChecklist = async () => {
    setLoading(true);
    try {
      if (user) {
        // Load from Amplify
        const result = await client.models.Checklist.get({ id: checklistId });
        if (result.data) {
          // Load sections
          const sectionsResult = await client.models.ChecklistSection.list({
            filter: { checklistId: { eq: checklistId } }
          });

          // Load all sections with their items
          const sectionsWithItems = await Promise.all(
            (sectionsResult.data || []).map(async (section) => {
              const itemsResult = await client.models.ChecklistItem.list({
                filter: { sectionId: { eq: section.id } },
                limit: 1000,
              });

              return {
                id: section.id,
                title: section.title,
                order: section.order,
                items: (itemsResult.data || [])
                  .sort((a, b) => a.order - b.order)
                  .map(item => ({
                    id: item.id,
                    title: item.title,
                    description: item.description || '',
                    order: item.order,
                    completed: item.completed || false,
                    tags: (item.tags || []).filter((tag): tag is string => tag !== null)
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
            sections: sectionsWithItems.sort((a, b) => a.order - b.order),
            progress: {},
            author: result.data.author // Preserve the author field
          };

          setChecklist(checklistData);

          // Build progress from item completed fields
          // If viewing a template (not owner), show all items as uncompleted
          const userProgress: Record<string, boolean> = {};
          sectionsWithItems.forEach(section => {
            section.items.forEach(item => {
              userProgress[item.id] = isOwner ? (item.completed || false) : false;
            });
          });

          setProgress(userProgress);
        }
      } else {
        // Load from local storage
        const localChecklist = LocalStorageManager.getChecklist(checklistId);
        if (localChecklist) {
          setChecklist(localChecklist);
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

  const checkAllInSection = async (sectionId: string) => {
    if (!checklist) return;

    const section = checklist.sections.find(s => s.id === sectionId);
    if (!section) return;

    // Determine if all items in this section are already completed
    const allSectionItemsCompleted = section.items.every(item => progress[item.id] === true);
    const newCompletedState = !allSectionItemsCompleted;

    // Create new progress with all items in this section toggled
    const newProgress = { ...progress };
    section.items.forEach(item => {
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
        // Delete from Amplify
        const sectionsResult = await client.models.ChecklistSection.list({
          filter: { checklistId: { eq: checklistId } }
        });

        // Delete all sections and items in parallel
        await Promise.all(
          (sectionsResult.data || []).map(async (section) => {
            const itemsResult = await client.models.ChecklistItem.list({
              filter: { sectionId: { eq: section.id } }
            });

            // Delete all items in this section in parallel
            await Promise.all(
              (itemsResult.data || []).map(item =>
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

  const handleClone = async () => {
    if (!checklist) return;

    try {
      // Clone checklist with all items set to uncompleted
      const clonedChecklist: LocalChecklist = {
        ...checklist,
        id: LocalStorageManager.generateId(),
        title: `${checklist.title} (Copy)`,
        isPublic: false, // Clones are private by default
        createdAt: new Date().toISOString(),
        progress: {},
        sections: checklist.sections.map(section => ({
          ...section,
          items: section.items.map(item => ({
            ...item,
            completed: false, // Reset all items to uncompleted
          }))
        }))
      };

      if (user) {
        // Save to Amplify
        const newChecklist = await client.models.Checklist.create({
          title: clonedChecklist.title,
          description: clonedChecklist.description || '',
          isPublic: false,
          author: user.username || user.userId,
          useCount: 0,
        });

        if (!newChecklist.data) {
          throw new Error('Failed to clone checklist');
        }

        // Clone sections and items (batched for performance)
        for (const section of checklist.sections) {
          const newSection = await client.models.ChecklistSection.create({
            checklistId: newChecklist.data.id,
            title: section.title,
            order: section.order,
          });

          if (newSection.data) {
            const sectionId = newSection.data.id;
            if (section.items.length > 0) {
              // Create all items in parallel instead of sequentially
              // Always set completed to false when copying
              await Promise.all(
                section.items.map(item =>
                  client.models.ChecklistItem.create({
                    sectionId: sectionId,
                    title: item.title,
                    description: item.description || '',
                    order: item.order,
                    completed: false,
                  })
                )
              );
            }
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

        alert('Added to your lists!');
        onBack();
      } else {
        // Save to local storage
        LocalStorageManager.saveChecklist(clonedChecklist);
        alert('Added to your lists!');
        onBack();
      }
    } catch (error) {
      console.error('Error copying checklist:', error);
      alert('Error copying checklist. Please try again.');
    }
  };

  const handleShare = async (shouldShare: boolean) => {
    if (!checklist || !user) return;

    try {
      await client.models.Checklist.update({
        id: checklistId,
        isPublic: shouldShare,
      });

      // Update local state
      setChecklist({
        ...checklist,
        isPublic: shouldShare,
      });

      setShowShareDialog(false);
      alert(shouldShare ? 'List is now shared as a public template!' : 'List is no longer shared');
    } catch (error) {
      console.error('Error updating share status:', error);
      alert('Error updating share status. Please try again.');
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
      <div className="view-header">
        <div className="view-header-top">
          <button onClick={onBack} className="back-button">
            ← Back
          </button>
          <div className="view-actions">
            {isOwner() ? (
              <>
                <button onClick={() => setShowShareDialog(true)} className="share-button" title="Share as template">
                  <span className="material-symbols-outlined">share</span>
                </button>
                <button onClick={() => onEdit(checklistId)} className="edit-button" title="Edit">
                  <span className="material-symbols-outlined">edit</span>
                </button>
                <button onClick={handleDelete} className="delete-button" title="Delete">
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </>
            ) : (
              <button onClick={handleClone} className="clone-button" title="Copy this checklist to your lists">
                Use this List
              </button>
            )}
          </div>
        </div>
        <div className="checklist-info">
          <h1>
            {checklist.title}
            {checklist.isPublic && (
              <span
                className="privacy-icon"
                title="Shared as public template"
              >
                <span className="material-symbols-outlined">public</span>
              </span>
            )}
          </h1>
          {checklist.description && (
            <p className="checklist-description">{checklist.description}</p>
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
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
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

      <div className="checklist-sections">
        {checklist.sections.map((section) => {
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
              const query = searchQuery.toLowerCase();
              return (
                item.title.toLowerCase().includes(query) ||
                item.description?.toLowerCase().includes(query)
              );
            }

            return true;
          });
          if (visibleItems.length === 0) return null;

          const allSectionItemsCompleted = section.items.every(item => progress[item.id] === true);

          return (
          <div key={section.id} className="section">
            <div className="section-header-view">
              <h2 className="section-title">{section.title}</h2>
              {isOwner() && visibleItems.length > 0 && (
                <button
                  onClick={() => checkAllInSection(section.id)}
                  className="check-all-button"
                  title={allSectionItemsCompleted ? "Uncheck all items in this section" : "Check all items in this section"}
                >
                  {allSectionItemsCompleted ? '✗ Uncheck all' : '✓ Check all'}
                </button>
              )}
            </div>
            <div className="section-items">
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className={`checklist-item ${progress[item.id] ? 'completed' : ''} ${!isOwner() ? 'disabled' : ''}`}
                  onClick={() => isOwner() && toggleItem(item.id)}
                  style={{ cursor: isOwner() ? 'pointer' : 'default' }}
                >
                  <span className="item-checkbox">
                    {progress[item.id] ? '☑' : '☐'}
                  </span>
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
                </div>
              ))}
            </div>
          </div>
        );
        })}
      </div>

      {showShareDialog && checklist && (
        <div className="share-dialog-overlay" onClick={() => setShowShareDialog(false)}>
          <div className="share-dialog-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-dialog" onClick={() => setShowShareDialog(false)}>✕</button>
            <h2>Share as Template</h2>
            {checklist.isPublic ? (
              <>
                <p>This list is currently shared as a public template. Others can view and copy it.</p>
                <div className="dialog-actions">
                  <button onClick={() => handleShare(false)} className="unshare-button">
                    Remove from Shared Templates
                  </button>
                  <button onClick={() => setShowShareDialog(false)} className="cancel-dialog-button">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>Do you want to share this list as a public template?</p>
                <p className="dialog-note">Others will be able to view and copy it to their own lists, but they won't see your progress.</p>
                <div className="dialog-actions">
                  <button onClick={() => handleShare(true)} className="share-confirm-button">
                    Share as Template
                  </button>
                  <button onClick={() => setShowShareDialog(false)} className="cancel-dialog-button">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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
    </div>
  );
};