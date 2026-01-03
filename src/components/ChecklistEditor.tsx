import React, { useState, useEffect } from 'react';
import { LocalStorageManager, LocalChecklist, LocalSection, LocalItem } from '../utils/localStorage';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

interface ChecklistEditorProps {
  checklistId: string | null;
  onSave: () => void;
  onCancel: () => void;
  user: any;
}

export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({
  checklistId,
  onSave,
  onCancel,
  user,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<LocalSection[]>([]);
  const [loading, setLoading] = useState(false);

  const isEditing = Boolean(checklistId);

  useEffect(() => {
    if (isEditing && checklistId) {
      loadChecklist(checklistId);
    } else {
      initializeNewChecklist();
    }
  }, [checklistId]);

  const loadChecklist = async (id: string) => {
    try {
      if (user) {
        // Load from Amplify
        const result = await client.models.Checklist.get({ id });
        if (result.data) {
          setTitle(result.data.title);
          setDescription(result.data.description || '');

          // Load sections
          const sectionsResult = await client.models.ChecklistSection.list({
            filter: { checklistId: { eq: id } }
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
                    order: item.order,
                    completed: item.completed || false
                  }))
              };
            })
          );

          setSections(sectionsWithItems.sort((a, b) => a.order - b.order));
        }
      } else {
        // Load from local storage
        const checklist = LocalStorageManager.getChecklist(id);
        if (checklist) {
          setTitle(checklist.title);
          setDescription(checklist.description || '');
          setSections(checklist.sections);
        }
      }
    } catch (error) {
      console.error('Error loading checklist:', error);
    }
  };

  const initializeNewChecklist = () => {
    setTitle('');
    setDescription('');
    setSections([
      {
        id: LocalStorageManager.generateId(),
        title: 'Section 1',
        order: 0,
        items: [],
      },
    ]);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert('Please enter a title for your checklist');
      return;
    }

    setLoading(true);

    try {
      if (user) {
        // Save to Amplify
        if (isEditing && checklistId) {
          // Update existing checklist
          await client.models.Checklist.update({
            id: checklistId,
            title: title.trim(),
            description: description.trim(),
          });

          // Smart diff: UPDATE existing, CREATE new, DELETE removed sections/items
          const existingSections = await client.models.ChecklistSection.list({
            filter: { checklistId: { eq: checklistId } }
          });

          const existingSectionIds = new Set((existingSections.data || []).map(s => s.id));
          const currentSectionIds = new Set(sections.map(s => s.id));

          // Delete removed sections (and their items)
          const sectionsToDelete = (existingSections.data || []).filter(s => !currentSectionIds.has(s.id));
          await Promise.all(
            sectionsToDelete.map(async (section) => {
              const existingItems = await client.models.ChecklistItem.list({
                filter: { sectionId: { eq: section.id } }
              });

              await Promise.all(
                (existingItems.data || []).map(item =>
                  client.models.ChecklistItem.delete({ id: item.id })
                )
              );

              await client.models.ChecklistSection.delete({ id: section.id });
            })
          );

          // Update or create sections
          for (const section of sections) {
            let sectionId = section.id;

            if (existingSectionIds.has(section.id)) {
              // Update existing section
              await client.models.ChecklistSection.update({
                id: section.id,
                title: section.title,
                order: section.order,
              });
            } else {
              // Create new section
              const newSection = await client.models.ChecklistSection.create({
                checklistId: checklistId!,
                title: section.title,
                order: section.order,
              });
              if (!newSection.data) continue;
              sectionId = newSection.data.id;
            }

            // Handle items for this section
            const existingItems = await client.models.ChecklistItem.list({
              filter: { sectionId: { eq: sectionId } }
            });

            const existingItemIds = new Set((existingItems.data || []).map(i => i.id));
            const currentItemIds = new Set(section.items.map(i => i.id));

            // Delete removed items
            const itemsToDelete = (existingItems.data || []).filter(i => !currentItemIds.has(i.id));
            await Promise.all(
              itemsToDelete.map(item => client.models.ChecklistItem.delete({ id: item.id }))
            );

            // Update existing items and create new ones
            const itemOperations = section.items.map(async (item) => {
              if (existingItemIds.has(item.id)) {
                // Update existing item (preserves completed field!)
                await client.models.ChecklistItem.update({
                  id: item.id,
                  title: item.title,
                  description: item.description || '',
                  order: item.order,
                });
              } else {
                // Create new item
                await client.models.ChecklistItem.create({
                  sectionId: sectionId,
                  title: item.title,
                  description: item.description || '',
                  order: item.order,
                  completed: item.completed || false,
                });
              }
            });

            await Promise.all(itemOperations);
          }
        } else {
          // Create new checklist
          const newChecklist = await client.models.Checklist.create({
            title: title.trim(),
            description: description.trim(),
            author: user.username || user.userId,
            viewCount: 0,
          });

          if (!newChecklist.data) {
            throw new Error('Failed to create checklist');
          }

          checklistId = newChecklist.data.id;

          // Create sections and items (batched for performance)
          for (const section of sections) {
            const newSection = await client.models.ChecklistSection.create({
              checklistId: checklistId!,
              title: section.title,
              order: section.order,
            });

            if (newSection.data) {
              const sectionId = newSection.data.id;
              if (section.items.length > 0) {
                // Create all items in parallel instead of sequentially
                await Promise.all(
                  section.items.map(item =>
                    client.models.ChecklistItem.create({
                      sectionId: sectionId,
                      title: item.title,
                      description: item.description || '',
                      order: item.order,
                    })
                  )
                );
              }
            }
          }
        }
      } else {
        // Save to local storage
        const checklist: LocalChecklist = {
          id: checklistId || LocalStorageManager.generateId(),
          title: title.trim(),
          description: description.trim(),
          isPublic: false,
          createdAt: new Date().toISOString(),
          sections,
          progress: {},
        };

        LocalStorageManager.saveChecklist(checklist);
      }

      onSave();
    } catch (error) {
      console.error('Error saving checklist:', error);
      alert('Error saving checklist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const addSection = () => {
    const newSection: LocalSection = {
      id: LocalStorageManager.generateId(),
      title: `Section ${sections.length + 1}`,
      order: sections.length,
      items: [],
    };

    setSections([...sections, newSection]);
  };

  const updateSection = (sectionId: string, updates: Partial<LocalSection>) => {
    setSections(sections.map(section =>
      section.id === sectionId ? { ...section, ...updates } : section
    ));
  };

  const deleteSection = (sectionId: string) => {
    if (sections.length <= 1) {
      alert('You need at least one section');
      return;
    }

    setSections(sections.filter(section => section.id !== sectionId));
  };

  const addItem = (sectionId: string, focusAfterAdd = false) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const newItem: LocalItem = {
      id: LocalStorageManager.generateId(),
      title: '',
      order: section.items.length,
    };

    updateSection(sectionId, {
      items: [...section.items, newItem],
    });

    // Focus the new item after it's added
    if (focusAfterAdd) {
      setTimeout(() => {
        const input = document.querySelector(`input[data-item-id="${newItem.id}"]`) as HTMLInputElement;
        if (input) input.focus();
      }, 0);
    }

    return newItem.id;
  };

  const handleItemTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, sectionId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(sectionId, true);
    } else if (e.key === 'Tab') {
      // Let tab naturally move to description
      // Don't prevent default
    }
  };

  const handleItemDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, sectionId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addItem(sectionId, true);
    }
    // Shift+Enter allows newlines in description
  };

  const updateItem = (sectionId: string, itemId: string, updates: Partial<LocalItem>) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const updatedItems = section.items.map(item =>
      item.id === itemId ? { ...item, ...updates } : item
    );

    updateSection(sectionId, { items: updatedItems });
  };

  const deleteItem = (sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const updatedItems = section.items.filter(item => item.id !== itemId);
    updateSection(sectionId, { items: updatedItems });
  };

  const moveItemUp = (sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const itemIndex = section.items.findIndex(item => item.id === itemId);
    if (itemIndex <= 0) return; // Already at top

    const updatedItems = [...section.items];
    [updatedItems[itemIndex - 1], updatedItems[itemIndex]] = [updatedItems[itemIndex], updatedItems[itemIndex - 1]];

    // Update order values
    updatedItems.forEach((item, index) => {
      item.order = index;
    });

    updateSection(sectionId, { items: updatedItems });
  };

  const moveItemDown = (sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const itemIndex = section.items.findIndex(item => item.id === itemId);
    if (itemIndex < 0 || itemIndex >= section.items.length - 1) return; // Already at bottom

    const updatedItems = [...section.items];
    [updatedItems[itemIndex], updatedItems[itemIndex + 1]] = [updatedItems[itemIndex + 1], updatedItems[itemIndex]];

    // Update order values
    updatedItems.forEach((item, index) => {
      item.order = index;
    });

    updateSection(sectionId, { items: updatedItems });
  };

  return (
    <div className="checklist-editor">
      <div className="editor-header">
        <h2>{isEditing ? 'Edit Checklist' : 'Create New Checklist'}</h2>
        <div className="header-actions">
          <button onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="save-button"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="editor-form">
        <div className="form-group">
          <label htmlFor="title">Title *</label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter checklist title"
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter checklist description (optional)"
            className="form-textarea"
            rows={3}
          />
        </div>

        <div className="sections-container">
          <div className="sections-header">
            <h3>Sections</h3>
          </div>

          {sections.map((section, sectionIndex) => (
            <React.Fragment key={section.id}>
              <div className="section-editor">
                <div className="section-header">
                  <input
                    type="text"
                    value={section.title}
                    onChange={(e) => updateSection(section.id, { title: e.target.value })}
                    className="section-title-input"
                  />
                  <button
                    onClick={() => deleteSection(section.id)}
                    className="delete-section-button"
                    disabled={sections.length <= 1}
                  >
                    🗑️
                  </button>
                </div>

                <div className="items-container">
                  {section.items.map((item, itemIndex) => (
                    <div key={item.id} className="item-editor">
                      <div className="item-inputs">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateItem(section.id, item.id, { title: e.target.value })}
                          onKeyDown={(e) => handleItemTitleKeyDown(e, section.id)}
                          placeholder="Item title"
                          className="item-title-input"
                          data-item-id={item.id}
                        />
                        <textarea
                          value={item.description || ''}
                          onChange={(e) => {
                            updateItem(section.id, item.id, { description: e.target.value });
                            // Auto-resize textarea
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          onKeyDown={(e) => handleItemDescriptionKeyDown(e, section.id)}
                          placeholder="Description (optional)"
                          className="item-description-input"
                        />
                      </div>
                      <div className="item-actions">
                        <button
                          onClick={() => moveItemUp(section.id, item.id)}
                          className="move-item-button"
                          disabled={itemIndex === 0}
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveItemDown(section.id, item.id)}
                          className="move-item-button"
                          disabled={itemIndex === section.items.length - 1}
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => deleteItem(section.id, item.id)}
                          className="delete-item-button"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => addItem(section.id, false)}
                    className="add-item-button"
                  >
                    + Add Item
                  </button>
                </div>
              </div>
              {sectionIndex < sections.length - 1 && (
                <div className="section-divider"></div>
              )}
            </React.Fragment>
          ))}

          <button onClick={addSection} className="add-section-button">
            + Add Section
          </button>
        </div>
      </div>
    </div>
  );
};