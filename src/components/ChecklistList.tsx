import React, { useState } from 'react';
import { LocalStorageManager } from '../utils/localStorage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

interface ChecklistListProps {
  checklists: any[];
  onEdit: (id: string) => void;
  onView: (id: string) => void;
  onCreate: () => void;
  user: any;
}

export const ChecklistList: React.FC<ChecklistListProps> = ({
  checklists,
  onEdit,
  onView,
  onCreate,
  user,
}) => {
  const [filter, setFilter] = useState<'mine' | 'public'>('mine');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'alphabetical'>('updated');

  const filteredChecklists = checklists
    .filter(checklist => {
      // Filter by view
      if (filter === 'mine') {
        if (!user) return true; // Local storage, show all
        return checklist.author === user.userId || checklist.author === user.username;
      }
      if (filter === 'public') return checklist.isPublic;
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
        // Delete from Amplify - delete sections and items first
        const sectionsResult = await client.models.ChecklistSection.list({
          filter: { checklistId: { eq: id } }
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

        // Delete user progress
        const progressResult = await client.models.UserProgress.list({
          filter: { checklistId: { eq: id } }
        });

        for (const progress of progressResult.data || []) {
          await client.models.UserProgress.delete({ id: progress.id });
        }

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

  if (checklists.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📋</div>
        <h2>No Checklists Yet</h2>
        <p>Create your first checklist to get started!</p>
        <button onClick={onCreate} className="create-button-large">
          Create Your First Checklist
        </button>
      </div>
    );
  }

  return (
    <div className="checklist-list">
      <div className="list-header">
        <h2>Your Checklists</h2>
        <div className="list-controls">
          <div className="filter-buttons">
            <button
              className={filter === 'mine' ? 'active' : ''}
              onClick={() => setFilter('mine')}
            >
              Created by Me
            </button>
            <button
              className={filter === 'public' ? 'active' : ''}
              onClick={() => setFilter('public')}
            >
              Public
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
            onChange={(e) => setSortBy(e.target.value as 'updated' | 'alphabetical')}
            className="sort-select"
          >
            <option value="updated">Recent</option>
            <option value="alphabetical">A-Z</option>
          </select>
        </div>
      </div>

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
                <span
                  className="privacy-icon"
                  title={checklist.isPublic ? 'Public' : 'Private'}
                >
                  {checklist.isPublic ? '🌍' : '🔒'}
                </span>
              </h3>
              <div className="card-actions">
                {isOwner(checklist) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(checklist.id);
                    }}
                    className="edit-button"
                  >
                    ✏️
                  </button>
                )}
                {isOwner(checklist) && (
                  <button
                    onClick={(e) => handleDelete(checklist.id, e)}
                    className="delete-button"
                  >
                    🗑️
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
              {checklist.sections && (
                <span>
                  {checklist.sections.reduce((total: number, section: any) => total + (section.items?.length || 0), 0)} items
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};