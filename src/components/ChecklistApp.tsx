import React, { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { ChecklistList } from './ChecklistList';
import { ChecklistView } from './ChecklistView';
import { Footer } from './Footer';
import { LocalStorageManager } from '../utils/localStorage';
import { Routes, Route, useNavigate } from 'react-router-dom';

const client = generateClient<Schema>();

interface ChecklistAppProps {
  user: any;
  signOut: (() => void) | null | undefined;
}

export const ChecklistApp: React.FC<ChecklistAppProps> = ({ user, signOut }) => {
  const [checklists, setChecklists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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

        navigate(`/checklists/${newChecklistId}`);
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
      navigate(`/checklists/${newChecklistId}`);
    }
  };

  const handleViewChecklist = (id: string) => {
    navigate(`/checklists/${id}`);
  };

  const handleBackToHome = () => {
    navigate('/checklists');
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
          <h1 className="app-title" onClick={() => navigate('/checklists')}>just<strong>checklists</strong></h1>
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

  if (loading) {
    return (
      <div className="checklist-app">
        {renderHeader()}
        <main className="app-main">
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="checklist-app">
      {renderHeader()}
      <main className="app-main">
        <Routes>
          <Route path="/" element={<ChecklistList checklists={checklists} onView={handleViewChecklist} onCreate={handleCreateChecklist} user={user} />} />
          <Route path="/checklists" element={<ChecklistList checklists={checklists} onView={handleViewChecklist} onCreate={handleCreateChecklist} user={user} />} />
          <Route path="/checklists/:checklistId" element={<ChecklistView onBack={handleBackToHome} user={user} />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
};