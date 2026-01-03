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
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [showTagSuggestions, setShowTagSuggestions] = useState<Record<string, boolean>>({});

  const isEditing = Boolean(checklistId);

  const getAllTagsInChecklist = (): string[] => {
    const allTags = new Set<string>();
    sections.forEach(section => {
      section.items.forEach(item => {
        if (item.tags) {
          item.tags.forEach(tag => allTags.add(tag));
        }
      });
    });
    return Array.from(allTags);
  };

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
                    completed: item.completed || false,
                    tags: (item.tags || []).filter((tag): tag is string => tag !== null)
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

    // Validate that all sections have titles
    for (const section of sections) {
      if (!section.title.trim()) {
        alert('Please enter a title for all sections');
        return;
      }
    }

    // Validate that all items have titles
    for (const section of sections) {
      for (const item of section.items) {
        if (!item.title.trim()) {
          alert(`Please enter a title for all items in "${section.title}"`);
          return;
        }
      }
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
                  tags: item.tags || [],
                });
              } else {
                // Create new item
                await client.models.ChecklistItem.create({
                  sectionId: sectionId,
                  title: item.title,
                  description: item.description || '',
                  order: item.order,
                  completed: item.completed || false,
                  tags: item.tags || [],
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
            useCount: 0,
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
                      tags: item.tags || [],
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

  const addTag = (sectionId: string, itemId: string, tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const item = section.items.find(i => i.id === itemId);
    if (!item) return;

    const currentTags = item.tags || [];
    if (currentTags.includes(trimmedTag)) return; // Tag already exists

    updateItem(sectionId, itemId, { tags: [...currentTags, trimmedTag] });
    setTagInput({ ...tagInput, [itemId]: '' });
    setShowTagSuggestions({ ...showTagSuggestions, [itemId]: false });
  };

  const removeTag = (sectionId: string, itemId: string, tagToRemove: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const item = section.items.find(i => i.id === itemId);
    if (!item) return;

    const updatedTags = (item.tags || []).filter(tag => tag !== tagToRemove);
    updateItem(sectionId, itemId, { tags: updatedTags });
  };

  const handleTagInputChange = (itemId: string, value: string) => {
    setTagInput({ ...tagInput, [itemId]: value });
    setShowTagSuggestions({ ...showTagSuggestions, [itemId]: value.length > 0 });
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, sectionId: string, itemId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = tagInput[itemId] || '';
      addTag(sectionId, itemId, tag);
    }
  };

  const getTagSuggestions = (itemId: string): string[] => {
    const input = (tagInput[itemId] || '').toLowerCase();
    if (!input) return [];

    const section = sections.find(s => s.items.some(i => i.id === itemId));
    if (!section) return [];

    const item = section.items.find(i => i.id === itemId);
    const currentTags = item?.tags || [];

    const allTags = getAllTagsInChecklist();
    return allTags
      .filter(tag => !currentTags.includes(tag) && tag.toLowerCase().includes(input))
      .slice(0, 5);
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
            rows={1}
          />
        </div>

        <div className="sections-container">
          {sections.map((section, sectionIndex) => (
            <React.Fragment key={section.id}>
              <div className="section-editor">
                <div className="section-header">
                  <input
                    type="text"
                    value={section.title}
                    onChange={(e) => updateSection(section.id, { title: e.target.value })}
                    placeholder="Section title *"
                    className="section-title-input"
                    required
                  />
                  <button
                    onClick={() => deleteSection(section.id)}
                    className="delete-section-button"
                    disabled={sections.length <= 1}
                  >
                    <span className="material-symbols-outlined">delete</span>
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
                          placeholder="Item title *"
                          className="item-title-input"
                          data-item-id={item.id}
                          required
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
                        <div className="item-tags-container">
                          {item.tags && item.tags.length > 0 && (
                            <div className="item-tags">
                              {item.tags.map(tag => (
                                <span key={tag} className="tag-pill">
                                  {tag}
                                  <button
                                    onClick={() => removeTag(section.id, item.id, tag)}
                                    className="tag-remove"
                                    type="button"
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
                              onBlur={() => setTimeout(() => setShowTagSuggestions({ ...showTagSuggestions, [item.id]: false }), 200)}
                              placeholder="Add tags..."
                              className="tag-input"
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
                          <span className="material-symbols-outlined">delete</span>
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