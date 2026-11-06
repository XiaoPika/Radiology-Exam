import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const AdminLoginPage = lazy(() => import('./pages/admin/LoginPage'));
const AdminDashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const ExamEditorPage = lazy(() => import('./pages/admin/ExamEditorPage'));
const StatisticsPage = lazy(() => import('./pages/admin/StatisticsPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'));
const RegisterPage = lazy(() => import('./pages/user/RegisterPage'));
const ExamPage = lazy(() => import('./pages/user/ExamPage'));
const ResultPage = lazy(() => import('./pages/user/ResultPage'));

const routeFallback = (
  <div style={{
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
    fontSize: '14px',
  }}>
    加载中...
  </div>
);

function App() {
  return (
    <Suspense fallback={routeFallback}>
      <Routes>
        {/* Admin routes */}
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin/exams/:id/edit" element={<ExamEditorPage />} />
        <Route path="/admin/exams/:id/statistics" element={<StatisticsPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />

        {/* User exam routes */}
        <Route path="/exam/:accessCode" element={<RegisterPage />} />
        <Route path="/exam/:accessCode/quiz" element={<ExamPage />} />
        <Route path="/exam/:accessCode/result/:sessionId" element={<ResultPage />} />

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
