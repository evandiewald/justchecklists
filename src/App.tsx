import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './App.css';
import { ChecklistApp } from './components/ChecklistApp';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);

function App() {
  return (
    <div className="App">
      <Authenticator
        socialProviders={['google']}
        hideSignUp={false}
        components={{
          Header() {
            return (
              <div className="auth-header">
                <h1>just<strong>checklists</strong></h1>
                <p>Literally just checklists.</p>
              </div>
            );
          },
        }}
      >
        {({ signOut, user }) => (
          <ChecklistApp user={user} signOut={signOut} />
        )}
      </Authenticator>
    </div>
  );
}

export default App;
