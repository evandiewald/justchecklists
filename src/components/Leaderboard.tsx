import React, { useState, useEffect } from 'react';
import { LocalStorageManager } from '../utils/localStorage';

interface LeaderboardProps {
  onBack: () => void;
  onViewChecklist: (id: string) => void;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  onBack,
  onViewChecklist,
}) => {
  const [popularChecklists, setPopularChecklists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPopularChecklists();
  }, []);

  const loadPopularChecklists = async () => {
    setLoading(true);
    try {
      // For now, use local storage. In a real app, you'd query public checklists
      // ordered by view count from your backend
      const allChecklists = LocalStorageManager.getAllChecklists();
      const publicChecklists = allChecklists.filter(list => list.isPublic);

      // Sort by view count (simulated) and title for demo
      const sorted = publicChecklists
        .map(checklist => ({
          ...checklist,
          viewCount: Math.floor(Math.random() * 1000) + 10, // Simulate view counts
        }))
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 20); // Top 20

      setPopularChecklists(sorted);
    } catch (error) {
      console.error('Error loading popular checklists:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading leaderboard...</p>
      </div>
    );
  }

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        <div className="header-content">
          <h1>🏆 Popular Checklists</h1>
          <p>Discover the most popular public checklists</p>
        </div>
      </div>

      {popularChecklists.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h2>No Public Checklists Yet</h2>
          <p>Be the first to create a public checklist!</p>
        </div>
      ) : (
        <div className="leaderboard-list">
          {popularChecklists.map((checklist, index) => (
            <div
              key={checklist.id}
              className="leaderboard-item"
              onClick={() => onViewChecklist(checklist.id)}
            >
              <div className="rank">
                <span className="rank-number">#{index + 1}</span>
                {index === 0 && <span className="trophy">🥇</span>}
                {index === 1 && <span className="trophy">🥈</span>}
                {index === 2 && <span className="trophy">🥉</span>}
              </div>

              <div className="checklist-info">
                <h3 className="checklist-title">{checklist.title}</h3>
                {checklist.description && (
                  <p className="checklist-description">{checklist.description}</p>
                )}
                <div className="checklist-meta">
                  <span className="view-count">👁️ {checklist.viewCount} views</span>
                  <span className="item-count">
                    {checklist.sections?.reduce(
                      (total: number, section: any) => total + (section.items?.length || 0),
                      0
                    )} items
                  </span>
                  <span className="section-count">
                    {checklist.sections?.length || 0} section{checklist.sections?.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              <div className="view-arrow">→</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};