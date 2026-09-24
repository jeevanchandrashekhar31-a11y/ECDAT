import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Assets } from './pages/Assets';
import { AssetDetail } from './pages/AssetDetail';
import { Reports } from './pages/Reports';
import { Roadmap } from './pages/Roadmap';
import { CryptoGraph } from './pages/CryptoGraph';
import { Findings } from './pages/Findings';
import { Remediation } from './pages/Remediation';

import { Login } from './pages/Login';
import { ProtectedRoute } from './components/ProtectedRoute';

interface ErrorBoundaryProps {
 children: ReactNode;
}

interface ErrorBoundaryState {
 hasError: boolean;
 error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
 constructor(props: ErrorBoundaryProps) {
 super(props);
 this.state = { hasError: false, error: null };
 }

 static getDerivedStateFromError(error: Error): ErrorBoundaryState {
 return { hasError: true, error };
 }

 componentDidCatch(error: Error, errorInfo: ErrorInfo) {
 console.error('ECDAT Root ErrorBoundary caught an error:', error, errorInfo);
 }

 render() {
 if (this.state.hasError) {
 return (
 <div className="min-h-screen bg-background text-text-brand flex items-center justify-center p-6">
 <div className="max-w-lg w-full bg-bg-1 border border-critical rounded-2xl p-6 shadow-md">
 <h2 className="text-xl font-bold text-critical mb-2">ECDAT UI Initialization Notice</h2>
 <p className="text-sm text-text-secondary mb-4">
 An unexpected render issue occurred while initializing the view.
 </p>
 <div className="bg-background p-3 rounded-lg border border-border text-xs font-mono text-critical mb-4 overflow-x-auto">
 {this.state.error?.message || 'Unknown Error'}
 </div>
 <button
 onClick={() => {
 this.setState({ hasError: false, error: null });
 window.location.reload();
 }}
 className="w-full py-2 px-4 rounded-xl bg-pqc hover:bg-crypto text-text-muted font-semibold text-sm transition-all"
 >
 Reload Application
 </button>
 </div>
 </div>
 );
 }
 return this.props.children;
 }
}

export const App: React.FC = () => {
 return (
 <BrowserRouter>
 <ErrorBoundary>
 <Routes>
 <Route path="/login" element={<Login />} />
 <Route element={<ProtectedRoute />}>
 <Route element={<Layout />}>
 <Route path="/" element={<Dashboard />} />
 <Route path="/assets" element={<Assets />} />
 <Route path="/assets/:assetId" element={<AssetDetail />} />
 <Route path="/findings" element={<Findings />} />
 <Route path="/remediation" element={<Remediation />} />
 <Route path="/roadmap" element={<Roadmap />} />
 <Route path="/graph" element={<CryptoGraph />} />
 <Route path="/reports" element={<Reports />} />
 </Route>
 </Route>
 <Route path="*" element={<Navigate to="/" replace />} />
 </Routes>
 </ErrorBoundary>
 </BrowserRouter>
 );
};

export default App;
