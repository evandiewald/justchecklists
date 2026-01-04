import React, { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { ChecklistList } from './ChecklistList';
import { ChecklistView } from './ChecklistView';
import { LocalStorageManager } from '../utils/localStorage';

const client = generateClient<Schema>();

interface ChecklistAppProps {
  user: any;
  signOut: (() => void) | null | undefined;
}

type View = 'home' | 'view';

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

      // No need to load sections - just use checklist data directly
      setChecklists(result.data || []);
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

  const handleCreateChecklist = async () => {
    const newChecklistId = LocalStorageManager.generateId();
    const newSectionId = LocalStorageManager.generateId();

    if (user) {
      // Create blank checklist in Amplify with client-generated IDs
      try {
        await client.models.Checklist.create({
          id: newChecklistId,
          title: 'New Checklist',
          description: '',
          author: user.username || user.userId,
          useCount: 0
        });

        // Create initial section
        await client.models.ChecklistSection.create({
          id: newSectionId,
          checklistId: newChecklistId,
          title: 'Section 1',
          order: 0
        });

        setSelectedChecklistId(newChecklistId);
        setCurrentView('view'); // Opens in ChecklistView
      } catch (error) {
        console.error('Error creating checklist:', error);
      }
    } else {
      // localStorage version
      const blankChecklist = {
        id: newChecklistId,
        title: 'New Checklist',
        description: '',
        isPublic: false,
        createdAt: new Date().toISOString(),
        sections: [{
          id: newSectionId,
          title: 'Section 1',
          order: 0,
          items: []
        }],
        progress: {}
      };
      LocalStorageManager.saveChecklist(blankChecklist);
      setSelectedChecklistId(newChecklistId);
      setCurrentView('view');
    }
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
        <div className="app-title-wrapper">
          <h1 className="app-title" onClick={() => setCurrentView('home')}>just<strong>checklists</strong></h1>
          <span className="beta-badge">beta</span>
        </div>
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
            onView={handleViewChecklist}
            onCreate={handleCreateChecklist}
            user={user}
          />
        );
      case 'view':
        return (
          <ChecklistView
            checklistId={selectedChecklistId!}
            onBack={handleBackToHome}
            user={user}
          />
        );
      default:
        return null;
    }
  };

  const renderFooter = () => (
    <footer className="app-footer">
      <div className="footer-content">
        <p className="copyright">© {new Date().getFullYear()} Evan Diewald</p>
        <div className="footer-links">
          <a
            href="https://buymeacoffee.com/evandiewald"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-icon-link"
            title="Buy me a coffee"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4v-2z"/>
            </svg>
          </a>
          <a
            href="https://github.com/evandiewald/justchecklists"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-icon-link"
            title="View on GitHub"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );

  return (
    <div className="checklist-app">
      {renderHeader()}
      <main className="app-main">
        {renderContent()}
      </main>
      {renderFooter()}
    </div>
  );
};