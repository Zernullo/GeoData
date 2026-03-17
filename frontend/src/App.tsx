/**
 * @fileoverview Root application component with lazy loading and error boundary.
 */

import { lazy, Suspense, Component } from 'react';
import './App.css';

// Lazy load the main component for better initial load time
const ImageUploader = lazy(() => import('./components/ImageUploader'));

// Loading component with cyber aesthetic
function LoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="w-12 h-12 border-2 border-green border-t-transparent rounded-full animate-spin" />
      <span className="text-green font-mono text-sm tracking-wider animate-pulse">
        [ INITIALIZING SYSTEM... ]
      </span>
    </div>
  );
}

// Error boundary component
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <h1 className="header-primary text-red mb-4">SYSTEM ERROR</h1>
          <p className="text-muted mb-6">An unexpected error occurred in the GEODATA interface.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 border border-green text-green hover:bg-green hover:text-black transition-all font-mono text-sm"
          >
            [ REBOOT SYSTEM ]
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <ImageUploader />
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;