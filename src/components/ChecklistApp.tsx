import React, { useState, useEffect } from 'react';
import { ChecklistList } from './ChecklistList';
import { ChecklistView } from './ChecklistView';
import { AcceptSharePage } from './AcceptSharePage';
import { Footer } from './Footer';
import { LocalStorageManager } from '../utils/localStorage';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Schema } from '../../amplify/data/resource';
import { generateClient } from 'aws-amplify/api';

interface ChecklistAppProps {
  user: any;
  signOut: (() => void) | null | undefined;
}

export const ChecklistApp: React.FC<ChecklistAppProps> = ({ user, signOut }) => {
  const [checklists, setChecklists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<any>(null);

  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      setClient(null);
      return;
    }

    const initClient = async () => {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
    
      if (!token) {
        throw new Error('No authentication token available');
      }
    
      setClient(generateClient<Schema>({
        authMode: 'lambda',
        authToken: `Token: ${token}`,
      }));
    };

    initClient();
  }, [user]);

  useEffect(() => {
    if (user) {
      if (!client) return; // Wait for client to be initialized
      fetchChecklists();
    } else {
      loadLocalChecklists();
    }
  }, [client, user]);


  const fetchChecklists = async () => {
    if (!client || !user) return; // Safety check

    setLoading(true);
    try {
      const userId = user.username || user.userId;

      // Fetch owned checklists
      const ownedResult = await client.models.Checklist.list({
        filter: { author: { eq: userId } }
      });

      // Fetch shared checklists via ChecklistShare GSI
      const sharesResult = await (client.models.ChecklistShare as any).listChecklistShareByUserId({ userId });
      console.log('Shares found:', sharesResult.data);

      // Fetch public checklists (templates)
      const publicResult = await client.models.Checklist.list({
        filter: { isPublic: { eq: true } }
      });

      // Get full checklist data for shared checklists
      const sharedChecklistPromises = (sharesResult.data || []).map(async (share: any) => {
        console.log('Fetching checklist for share:', share.checklistId);
        const checklistResult = await client.models.Checklist.get({ id: share.checklistId });
        console.log('Got checklist:', checklistResult.data);
        return checklistResult.data;
      });
      const sharedChecklists = (await Promise.all(sharedChecklistPromises)).filter(Boolean);
      console.log('Shared checklists:', sharedChecklists);

      // Combine all checklists (owned, shared, public) - avoid duplicates
      const allChecklistsMap = new Map();

      // Add owned checklists
      (ownedResult.data || []).forEach((c: any) => allChecklistsMap.set(c.id, c));

      // Add shared checklists
      sharedChecklists.forEach((c: any) => {
        if (c && !allChecklistsMap.has(c.id)) {
          allChecklistsMap.set(c.id, c);
        }
      });

      // Add public checklists
      (publicResult.data || []).forEach((c: any) => {
        if (!allChecklistsMap.has(c.id)) {
          allChecklistsMap.set(c.id, c);
        }
      });

      console.log('Owned:', ownedResult.data?.length, 'Shared:', sharedChecklists.length, 'Public:', publicResult.data?.length);
      setChecklists(Array.from(allChecklistsMap.values()));
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

    if (user && client) {
      // Create blank checklist in Amplify with client-generated IDs
      try {
        const authorId = user.username || user.userId;

        await client.models.Checklist.create({
          id: newChecklistId,
          title: 'New Checklist',
          description: '',
          author: authorId,
          useCount: 0
        });

        // Create initial section
        await client.models.ChecklistSection.create({
          id: newSectionId,
          checklistId: newChecklistId,
          title: 'Section 1',
          order: 0
        });

        // Create OWNER share for the creator
        const userEmail = user.attributes?.email || user.signInDetails?.loginId || authorId;
        await client.models.ChecklistShare.create({
          checklistId: newChecklistId,
          userId: authorId,
          email: userEmail,
          role: 'OWNER',
          sharedBy: authorId,
          createdAt: new Date().toISOString(),
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
          <Route path="/share/:token" element={<AcceptSharePage user={user} />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
};