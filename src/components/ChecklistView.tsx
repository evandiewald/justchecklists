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
                filter: { sectionId: { eq: section.id } }
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
                    order: item.order
                  }))
              };
            })
          );

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

          // Load user progress
          const progressResult = await client.models.UserProgress.list({
            filter: {
              checklistId: { eq: checklistId },
              userId: { eq: user.username || user.userId }
            }
          });

          const userProgress: Record<string, boolean> = {};
          (progressResult.data || []).forEach(p => {
            if (p.itemId && p.completed !== null && p.completed !== undefined) {
              userProgress[p.itemId] = p.completed;
            }
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
      // Update progress in Amplify
      try {
        // Check if progress entry exists
        const existingProgress = await client.models.UserProgress.list({
          filter: {
            checklistId: { eq: checklistId },
            itemId: { eq: itemId },
            userId: { eq: user.username || user.userId }
          }
        });

        if (existingProgress.data && existingProgress.data.length > 0) {
          // Update existing progress
          await client.models.UserProgress.update({
            id: existingProgress.data[0].id,
            completed: newCompleted,
            completedAt: newCompleted ? new Date().toISOString() : null
          });
        } else {
          // Create new progress entry
          await client.models.UserProgress.create({
            userId: user.username || user.userId,
            checklistId,
            itemId,
            completed: newCompleted,
            completedAt: newCompleted ? new Date().toISOString() : null
          });
        }
      } catch (error) {
        console.error('Error updating progress:', error);
      }
    } else {
      // Update progress in local storage
      LocalStorageManager.updateProgress(checklistId, itemId, newCompleted);
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

        for (const section of sectionsResult.data || []) {
          const itemsResult = await client.models.ChecklistItem.list({
            filter: { sectionId: { eq: section.id } }
          });

          for (const item of itemsResult.data || []) {
            await client.models.ChecklistItem.delete({ id: item.id });
          }

          await client.models.ChecklistSection.delete({ id: section.id });
        }

        const progressResult = await client.models.UserProgress.list({
          filter: { checklistId: { eq: checklistId } }
        });

        for (const progress of progressResult.data || []) {
          await client.models.UserProgress.delete({ id: progress.id });
        }

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
      const clonedChecklist: LocalChecklist = {
        ...checklist,
        id: LocalStorageManager.generateId(),
        title: `${checklist.title} (Copy)`,
        isPublic: false, // Clones are private by default
        createdAt: new Date().toISOString(),
        progress: {},
      };

      if (user) {
        // Save to Amplify
        const newChecklist = await client.models.Checklist.create({
          title: clonedChecklist.title,
          description: clonedChecklist.description || '',
          isPublic: false,
          author: user.username || user.userId,
          viewCount: 0,
        });

        if (!newChecklist.data) {
          throw new Error('Failed to clone checklist');
        }

        // Clone sections and items
        for (const section of checklist.sections) {
          const newSection = await client.models.ChecklistSection.create({
            checklistId: newChecklist.data.id,
            title: section.title,
            order: section.order,
          });

          if (newSection.data) {
            for (const item of section.items) {
              await client.models.ChecklistItem.create({
                sectionId: newSection.data.id,
                title: item.title,
                description: item.description || '',
                order: item.order,
              });
            }
          }
        }

        alert('Checklist cloned successfully!');
        onBack();
      } else {
        // Save to local storage
        LocalStorageManager.saveChecklist(clonedChecklist);
        alert('Checklist cloned successfully!');
        onBack();
      }
    } catch (error) {
      console.error('Error cloning checklist:', error);
      alert('Error cloning checklist. Please try again.');
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
                <button onClick={() => onEdit(checklistId)} className="edit-button" title="Edit">
                  ✏️
                </button>
                <button onClick={handleDelete} className="delete-button" title="Delete">
                  🗑️
                </button>
              </>
            ) : (
              <button onClick={handleClone} className="clone-button" title="Clone this checklist">
                📋
              </button>
            )}
          </div>
        </div>
        <div className="checklist-info">
          <h1>
            {checklist.title}
            <span
              className="privacy-icon"
              title={checklist.isPublic ? 'Public' : 'Private'}
            >
              {checklist.isPublic ? '🌍' : '🔒'}
            </span>
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

          return (
          <div key={section.id} className="section">
            <h2 className="section-title">{section.title}</h2>
            <div className="section-items">
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className={`checklist-item ${progress[item.id] ? 'completed' : ''}`}
                  onClick={() => toggleItem(item.id)}
                >
                  <span className="item-checkbox">
                    {progress[item.id] ? '☑' : '☐'}
                  </span>
                  <div className="item-content">
                    <span className="item-title">{item.title}</span>
                    {item.description && (
                      <span className="item-description">({item.description})</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
        })}
      </div>

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