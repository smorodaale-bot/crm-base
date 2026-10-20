import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { AppLoader } from './components/AppLoader.jsx';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const PipelinePage = lazy(() => import('./pages/PipelinePage.jsx'));
const ClientsPage = lazy(() => import('./pages/ClientsPage.jsx'));
const ClientFormPage = lazy(() => import('./pages/ClientFormPage.jsx'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage.jsx'));
const DealsPage = lazy(() => import('./pages/DealsPage.jsx'));
const DealDetailPage = lazy(() => import('./pages/DealDetailPage.jsx'));
const DealChatPage = lazy(() => import('./pages/DealChatPage.jsx'));
const ActivityPage = lazy(() => import('./pages/ActivityPage.jsx'));
const QcListPage = lazy(() => import('./pages/QcListPage.jsx'));
const QcDetailPage = lazy(() => import('./pages/QcDetailPage.jsx'));
const QcReportPage = lazy(() => import('./pages/QcReportPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const TasksPage = lazy(() => import('./pages/TasksPage.jsx'));
const RemindersPage = lazy(() => import('./pages/RemindersPage.jsx'));
const InboxPage = lazy(() => import('./pages/InboxPage.jsx'));
const VisitsPage = lazy(() => import('./pages/VisitsPage.jsx'));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage.jsx'));
const VehicleDetailPage = lazy(() => import('./pages/VehicleDetailPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.jsx'));
const InvitePage = lazy(() => import('./pages/InvitePage.jsx'));
const RegisterOrgPage = lazy(() => import('./pages/RegisterOrgPage.jsx'));
const OrgSettingsPage = lazy(() => import('./pages/OrgSettingsPage.jsx'));
const OrgBillingPage = lazy(() => import('./pages/OrgBillingPage.jsx'));
const OrgChannelsPage = lazy(() => import('./pages/OrgChannelsPage.jsx'));
const OrgTeamPage = lazy(() => import('./pages/OrgTeamPage.jsx'));
const PricingPage = lazy(() => import('./pages/PricingPage.jsx'));
const OfferPage = lazy(() => import('./pages/OfferPage.jsx'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.jsx'));
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'));
const PaymentCancelPage = lazy(() => import('./pages/PaymentCancelPage.jsx'));

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <AppLoader variant="fullscreen" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function SupervisorRoute({ children }) {
  const { user, loading, isSupervisor } = useAuth();
  if (loading) return <AppLoader variant="fullscreen" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isSupervisor) return <Navigate to="/inbox" replace />;
  return children;
}

function FeatureRoute({ feature, children }) {
  const { canQc, canStock, loading, user } = useAuth();
  if (loading) return <AppLoader variant="fullscreen" />;
  if (!user) return <Navigate to="/login" replace />;
  const ok = feature === 'qc' ? canQc : feature === 'stock' ? canStock : true;
  if (!ok) return <Navigate to="/org" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<AppLoader variant="fullscreen" />}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterOrgPage />} />
      <Route path="/forgot" element={<ForgotPasswordPage />} />
      <Route path="/reset" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/offer" element={<OfferPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/contacts" element={<ContactsPage />} />
      <Route path="/payment/cancel" element={<PaymentCancelPage />} />
      <Route
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="org"
          element={
            <SupervisorRoute>
              <OrgSettingsPage />
            </SupervisorRoute>
          }
        />
        <Route
          path="org/billing"
          element={
            <SupervisorRoute>
              <OrgBillingPage />
            </SupervisorRoute>
          }
        />
        <Route
          path="org/channels"
          element={
            <SupervisorRoute>
              <OrgChannelsPage />
            </SupervisorRoute>
          }
        />
        <Route
          path="org/team"
          element={
            <SupervisorRoute>
              <OrgTeamPage />
            </SupervisorRoute>
          }
        />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="visits" element={<VisitsPage />} />
        <Route
          path="vehicles"
          element={
            <FeatureRoute feature="stock">
              <VehiclesPage />
            </FeatureRoute>
          }
        />
        <Route
          path="vehicles/:id"
          element={
            <FeatureRoute feature="stock">
              <VehicleDetailPage />
            </FeatureRoute>
          }
        />
        <Route
          path="analytics"
          element={
            <SupervisorRoute>
              <AnalyticsPage />
            </SupervisorRoute>
          }
        />
        <Route path="deals" element={<DealsPage />} />
        <Route path="deals/:id/chat" element={<DealChatPage />} />
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
              <FeatureRoute feature="qc">
                <QcListPage />
              </FeatureRoute>
            </SupervisorRoute>
          }
        />
        <Route
          path="qc/report"
          element={
            <SupervisorRoute>
              <FeatureRoute feature="qc">
                <QcReportPage />
              </FeatureRoute>
            </SupervisorRoute>
          }
        />
        <Route
          path="qc/:id"
          element={
            <SupervisorRoute>
              <FeatureRoute feature="qc">
                <QcDetailPage />
              </FeatureRoute>
            </SupervisorRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
