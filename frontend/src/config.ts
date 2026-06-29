const isDev = process.env.NODE_ENV === 'development';
export const API_BASE = isDev 
  ? 'http://localhost:5000' 
  : (process.env.NEXT_PUBLIC_API_URL || 'https://chronos-backend-410257364704.europe-west1.run.app');
