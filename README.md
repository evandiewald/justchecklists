# justchecklists

A simple and beautiful checklist app with a legal pad design, built with React and AWS Amplify.

## Features

- ✅ Create, edit, and delete checklists
- 📝 Organize checklists into sections with multiple items
- 🔒 Private and public checklist visibility options
- 📱 Mobile-responsive legal pad design
- 🏆 Leaderboard showing most popular public checklists
- 👤 Google OAuth authentication
- 💾 Local storage support for anonymous users
- 📊 Progress tracking with visual progress bars

## Design

The app features a unique legal pad design with:
- Yellow paper background
- Blue horizontal lines
- Pink margin line
- Clean, sans-serif typography
- "justchecklists" branding where "checklists" is bolded

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- AWS Account (for production deployment)
- Google OAuth credentials (for authentication)

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.local` and add your Google OAuth credentials
   - Get credentials from [Google Developer Console](https://console.developers.google.com/)

4. Start the development server:
   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Google OAuth Setup

1. Go to [Google Developer Console](https://console.developers.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - `http://localhost:3000/` (for development)
   - Your production URL (for production)
6. Update `.env.local` with your client ID and secret

### AWS Amplify Gen 2 Setup

For production deployment with full authentication and database features:

1. Create an Amplify app in the AWS Console and connect your GitHub repository

2. Start a local development sandbox:
   ```bash
   npm run sandbox
   ```

3. Deploy to production:
   ```bash
   npm run deploy
   ```

4. Generate outputs for your app:
   ```bash
   npx amplify generate outputs --app-id <your-app-id> --branch-name main
   ```

Note: This project uses AWS Amplify Gen 2 (code-first approach), not Gen 1. No `amplify init` required!

## Usage

### Without Authentication (Local Storage)
- Create and manage checklists stored locally in your browser
- Data persists across browser sessions
- No Google account required

### With Authentication (Google OAuth)
- Sign in with your Google account
- Sync checklists across devices
- Access public leaderboard
- Create both private and public checklists

### Creating Checklists

1. Click "Create List" to start a new checklist
2. Add a title and optional description
3. Choose privacy settings (private or public)
4. Organize items into sections
5. Add items with optional descriptions
6. Save your checklist

### Using Checklists

1. Click on any checklist to view it
2. Check off items as you complete them
3. View progress with the visual progress bar
4. Celebrate when you complete all items!

## Available Scripts

- `npm start` - Runs the app in development mode
- `npm test` - Launches the test runner
- `npm run build` - Builds the app for production
- `npm run eject` - Ejects from Create React App (irreversible)

## Technologies Used

- **Frontend**: React 19, TypeScript, CSS3
- **Backend**: AWS Amplify Gen 2
- **Authentication**: AWS Cognito with Google OAuth
- **Database**: AWS AppSync with DynamoDB
- **Styling**: Custom CSS with legal pad design
- **Local Storage**: Browser localStorage API

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License.
