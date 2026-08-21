import { Component } from 'react';

// Without this, any uncaught render error (a malformed question object slipping through,
// a future regression, etc.) unmounts the whole React tree and leaves a blank white page
// with no way back except a manual refresh. This catches it and offers a recovery path.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('MedFlash crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel error-boundary">
          <h2>Something went wrong</h2>
          <p className="muted">
            {this.props.label || 'This screen hit an unexpected error.'} You can try again, or go
            back and pick something else.
          </p>
          <div className="error-boundary-actions">
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            {this.props.onExit && (
              <button className="ghost" onClick={() => { this.setState({ error: null }); this.props.onExit(); }}>
                Back to decks
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
