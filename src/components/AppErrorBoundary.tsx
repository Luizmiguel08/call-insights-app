import React from "react";

interface State { hasError: boolean; error?: Error }

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-[100dvh] flex items-center justify-center bg-[#0f1117] text-zinc-100 px-4"
          style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
        >
          <div className="max-w-md w-full text-center rounded-2xl border border-zinc-800 bg-[#171a23] p-8 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100">Algo deu errado</h2>
            <p className="text-sm text-zinc-400">
              Tente recarregar a página. Se o problema continuar, contate o suporte.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-[#c9a24c] px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-black hover:bg-[#e6c878] transition"
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
