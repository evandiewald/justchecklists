import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShareLinkManager } from '../utils/shareLinks';
import '../styles/AcceptSharePage.css';

interface AcceptSharePageProps {
  user: any;
}

export const AcceptSharePage: React.FC<AcceptSharePageProps> = ({ user }) => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const acceptShare = async () => {
      if (!token) {
        setError('Invalid share link');
        setLoading(false);
        return;
      }

      if (!user) {
        // Redirect to login, then back here
        navigate(`/?redirect=/share/${token}`);
        return;
      }

      try {
        const checklistId = await ShareLinkManager.acceptShareLink(token, user);
        navigate(`/checklists/${checklistId}`);
      } catch (err) {
        console.error('Error accepting share link:', err);
        setError('Invalid or expired share link');
        setLoading(false);
      }
    };

    acceptShare();
  }, [token, user, navigate]);

  if (loading) {
    return (
      <div className="accept-share-page">
        <div className="accept-share-card">
          <div className="spinner"></div>
          <h2>Accepting invite...</h2>
          <p>Please wait while we add you to the shared list</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="accept-share-page">
        <div className="accept-share-card error">
          <span className="material-symbols-outlined error-icon">error</span>
          <h2>Error</h2>
          <p>{error}</p>
          <button className="back-button" onClick={() => navigate('/checklists')}>
            Go to My Lists
          </button>
        </div>
      </div>
    );
  }

  return null;
};
