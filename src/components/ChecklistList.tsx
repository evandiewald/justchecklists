import React, { useState, useEffect } from 'react';
import { LocalStorageManager } from '../utils/localStorage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

interface ChecklistListProps {
  checklists: any[];
  onView: (id: string) => void;
  onCreate: () => void;
  user: any;
}

export const ChecklistList: React.FC<ChecklistListProps> = ({
  checklists,
  onView,
  onCreate,
  user,
}) => {
  const [filter, setFilter] = useState<'mine' | 'shared'>('mine');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'alphabetical' | 'trending' | 'mostUsed'>('updated');

  // Reset sort when filter changes
  useEffect(() => {
    if (filter === 'mine' && (sortBy === 'trending' || sortBy === 'mostUsed')) {
      setSortBy('updated');
    } else if (filter === 'shared' && sortBy === 'updated') {
      setSortBy('trending');
    }
  }, [filter]);

  const filteredChecklists = checklists
    .filter(checklist => {
      // Filter by view
      if (filter === 'mine') {
        if (!user) return true; // Local storage, show all
        return checklist.author === user.userId || checklist.author === user.username;
      }
      if (filter === 'shared') {
        // Shared lists are public lists created by OTHER users
        if (!user) return false; // No shared lists in local storage mode
        const isOwnList = checklist.author === user.userId || checklist.author === user.username;
        return checklist.isPublic && !isOwnList;
      }
      return true;
    })
    .filter(checklist => {
      // Filter by search
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        checklist.title.toLowerCase().includes(query) ||
        checklist.description?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      // Sort
      if (sortBy === 'alphabetical') {
        return a.title.localeCompare(b.title);
      } else if (sortBy === 'trending') {
        // Sort by lastUsedAt (most recent first)
        const aDate = new Date((a as any).lastUsedAt || 0).getTime();
        const bDate = new Date((b as any).lastUsedAt || 0).getTime();
        return bDate - aDate;
      } else if (sortBy === 'mostUsed') {
        // Sort by useCount (highest first)
        const aCount = (a as any).useCount || 0;
        const bCount = (b as any).useCount || 0;
        return bCount - aCount;
      } else {
        // Sort by updated (most recent first)
        const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bDate - aDate;
      }
    });

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();

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
            filter: { checklistId: { eq: id } },
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

        // Finally delete the checklist
        await client.models.Checklist.delete({ id });
      } else {
        // Delete from local storage
        LocalStorageManager.deleteChecklist(id);
      }

      window.location.reload(); // Refresh to show updated list
    } catch (error) {
      console.error('Error deleting checklist:', error);
      alert('Error deleting checklist. Please try again.');
    }
  };

  const isOwner = (checklist: any) => {
    if (!user) return false;
    return checklist.author === user.userId;
  };

  return (
    <div className="checklist-list">
      <div className="list-header">
        <h2>Checklists</h2>
        <div className="list-controls">
          <div className="filter-buttons">
            <button
              className={filter === 'mine' ? 'active' : ''}
              onClick={() => setFilter('mine')}
            >
              My Lists
            </button>
            <button
              className={filter === 'shared' ? 'active' : ''}
              onClick={() => setFilter('shared')}
            >
              Shared Templates
            </button>
          </div>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'updated' | 'alphabetical' | 'trending' | 'mostUsed')}
            className="sort-select"
          >
            {filter === 'mine' ? (
              <>
                <option value="updated">Recent</option>
                <option value="alphabetical">A-Z</option>
              </>
            ) : (
              <>
                <option value="trending">Trending</option>
                <option value="mostUsed">Most Used</option>
                <option value="alphabetical">A-Z</option>
              </>
            )}
          </select>
        </div>
      </div>

      {filteredChecklists.length === 0 ? (
        <div className="empty-state">
          {filter === 'mine' ? (
            <>
              <h2>No Checklists Yet</h2>
              <p>
                Create your first checklist or start from a{' '}
                <span className="shared-template-link" onClick={() => setFilter('shared')}>
                  shared template
                </span>{' '}
                to get started!
              </p>
              <button onClick={onCreate} className="create-button-large">
                Create Your First Checklist
              </button>
            </>
          ) : (
            <>
              <h2>No Shared Templates</h2>
              <p>There are no public templates available yet. Check back later or create your own!</p>
            </>
          )}
        </div>
      ) : (
        <div className="checklist-grid">
          {filteredChecklists.map(checklist => (
            <div
              key={checklist.id}
              className="checklist-card"
              onClick={() => onView(checklist.id)}
            >
              <div className="card-header">
                <h3>
                  {checklist.title}
                  {checklist.isPublic && (
                    <span
                      className="privacy-icon shared-badge"
                      title="Shared as public template"
                    >
                      <span className="material-symbols-outlined">public</span>
                    </span>
                  )}
                </h3>
                <div className="card-actions">
                  {isOwner(checklist) && (
                    <button
                      onClick={(e) => handleDelete(checklist.id, e)}
                      className="delete-button"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  )}
                </div>
              </div>

              {checklist.description && (
                <p className="card-description">{checklist.description}</p>
              )}

              <div className="card-stats">
                {checklist.sections?.length > 0 && (
                  <span>{checklist.sections.length} section{checklist.sections.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};