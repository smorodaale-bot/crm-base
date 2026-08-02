import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PipelinePage from './pages/PipelinePage.jsx';
import ClientsPage from './pages/ClientsPage.jsx';
import ClientFormPage from './pages/ClientFormPage.jsx';
import ClientDetailPage from './pages/ClientDetailPage.jsx';
import DealsPage from './pages/DealsPage.jsx';
import DealDetailPage from './pages/DealDetailPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import QcListPage from './pages/QcListPage.jsx';
import QcDetailPage from './pages/QcDetailPage.jsx';
import QcReportPage from './pages/QcReportPage.jsx';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="centered">Загрузка...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function SupervisorRoute({ children }) {
  const { user, loading, isSupervisor } = useAuth();
  if (loading) return <div className="centered">Загрузка...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isSupervisor) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<PipelinePage />} />
        <Route path="deals" element={<DealsPage />} />
        <Route path="deals/:id" element={<DealDetailPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/new" element={<ClientFormPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="clients/:id/edit" element={<ClientFormPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route
          path="qc"
          element={
            <SupervisorRoute>
              <QcListPage />
            </SupervisorRoute>
          }
        />
        <Route
          path="qc/report"
          element={
            <SupervisorRoute>
              <QcReportPage />
            </SupervisorRoute>
          }
        />
        <Route
          path="qc/:id"
          element={
            <SupervisorRoute>
              <QcDetailPage />
            </SupervisorRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
