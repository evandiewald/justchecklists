import React, { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { ChecklistList } from './ChecklistList';
import { ChecklistView } from './ChecklistView';
import { ChecklistEditor } from './ChecklistEditor';
import { LocalStorageManager } from '../utils/localStorage';

const client = generateClient<Schema>();

interface ChecklistAppProps {
  user: any;
  signOut: (() => void) | null | undefined;
}

type View = 'home' | 'create' | 'edit' | 'view';

export const ChecklistApp: React.FC<ChecklistAppProps> = ({ user, signOut }) => {
  const [currentView, setCurrentView] = useState<View>('home');
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchChecklists();
    } else {
      loadLocalChecklists();
    }
  }, [user]);

  const fetchChecklists = async () => {
    setLoading(true);
    try {
      const result = await client.models.Checklist.list({
        authMode: user ? 'userPool' : 'apiKey',
      });

      // Only load sections for list view (no items needed for display)
      const checklistsWithSections = await Promise.all(
        (result.data || []).map(async (checklist) => {
          const sectionsResult = await client.models.ChecklistSection.list({
            filter: { checklistId: { eq: checklist.id } },
            authMode: user ? 'userPool' : 'apiKey',
          });

          return {
            ...checklist,
            sections: (sectionsResult.data || []).map(section => ({
              ...section,
              items: [] // Empty array for list view - items loaded on-demand when viewing
            }))
          };
        })
      );

      setChecklists(checklistsWithSections);
    } catch (error) {
      console.error('Error fetching checklists:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLocalChecklists = () => {
    setLoading(true);
    const localChecklists = LocalStorageManager.getAllChecklists();
    setChecklists(localChecklists);
    setLoading(false);
  };

  const handleCreateChecklist = () => {
    setSelectedChecklistId(null);
    setCurrentView('create');
  };

  const handleEditChecklist = (id: string) => {
    setSelectedChecklistId(id);
    setCurrentView('edit');
  };

  const handleViewChecklist = (id: string) => {
    setSelectedChecklistId(id);
    setCurrentView('view');
  };

  const handleBackToHome = () => {
    setCurrentView('home');
    setSelectedChecklistId(null);
    if (user) {
      fetchChecklists();
    } else {
      loadLocalChecklists();
    }
  };


  const renderHeader = () => (
    <header className="app-header">
      <div className="header-content">
        <h1 className="app-title" onClick={() => setCurrentView('home')}>just<strong>checklists</strong></h1>
        <nav className="header-nav">
          <button onClick={handleCreateChecklist} className="create-button" title="Create List">
            <span className="material-symbols-outlined">add</span>
          </button>
          {user && signOut && (
            <button onClick={signOut} className="sign-out-button" title="Sign Out">
              <span className="material-symbols-outlined">logout</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      );
    }

    switch (currentView) {
      case 'home':
        return (
          <ChecklistList
            checklists={checklists}
            onEdit={handleEditChecklist}
            onView={handleViewChecklist}
            onCreate={handleCreateChecklist}
            user={user}
          />
        );
      case 'create':
      case 'edit':
        return (
          <ChecklistEditor
            checklistId={selectedChecklistId}
            onSave={handleBackToHome}
            onCancel={handleBackToHome}
            user={user}
          />
        );
      case 'view':
        return (
          <ChecklistView
            checklistId={selectedChecklistId!}
            onBack={handleBackToHome}
            onEdit={handleEditChecklist}
            user={user}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="checklist-app">
      {renderHeader()}
      <main className="app-main">
        {renderContent()}
      </main>
    </div>
  );
};