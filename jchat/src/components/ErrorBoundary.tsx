import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  retryKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[jchat ErrorBoundary]', error, info);
  }

  reset = () => {
    this.setState({ error: null, retryKey: this.state.retryKey + 1 });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-wechat-bg dark:bg-gray-950 p-8 text-center">
          <div className="text-2xl font-medium text-gray-700 dark:text-gray-200">出错了</div>
          {process.env.NODE_ENV !== 'production' && (
            <pre className="max-w-2xl whitespace-pre-wrap rounded bg-white dark:bg-gray-800 p-4 text-left text-xs text-red-600 dark:text-red-400 shadow">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack?.slice(0, 1500)}
            </pre>
          )}
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md bg-wechat-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            重试
          </button>
        </div>
      );
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
