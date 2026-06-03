/**
 * Per-widget React error boundary. Catches render-phase exceptions thrown by a single
 * widget (e.g. OpenLayers / React DOM reconciler desync inside MapChartRenderer when
 * a layer's ImageWMS fires `imageloaderror` mid-render and the resulting setState
 * collides with an OL-mutated child node — observed live after a dynamic-view-bound
 * layer issued an error tile while the user added a second map widget).
 *
 * Without this boundary, a render failure inside one widget crashes the entire
 * DashboardOpen tree (the WidgetRenderer's parent grid cell propagates up to
 * DashboardsPage). The boundary scopes the failure to one card and surfaces a
 * recover-by-retry control so the operator doesn't lose the rest of the dashboard.
 *
 * Pattern: React's recommended class-component boundary. No functional-hook
 * equivalent exists for componentDidCatch / getDerivedStateFromError.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  /** Optional label surfaced in the fallback ("Failed to render: {label}"). Defaults to "widget". */
  widgetLabel?: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export default class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to dev console for diagnosability — production telemetry hook would
    // attach here if/when one is introduced.
    // eslint-disable-next-line no-console
    console.error(
      "[WidgetErrorBoundary] widget render crashed:",
      error,
      info.componentStack,
    );
  }

  handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="widget-error-boundary" role="alert">
          <div className="widget-error-boundary-title">
            Failed to render {this.props.widgetLabel ?? "widget"}
          </div>
          <div className="widget-error-boundary-message">
            {this.state.error.message ?? "Unknown error"}
          </div>
          <button
            type="button"
            className="ghost-sm"
            onClick={this.handleRetry}
            aria-label="Retry rendering widget"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
