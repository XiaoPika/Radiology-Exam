import apiClient from './client';

const UPLOAD_TIMEOUT_MS = 600000;

// === Admin Auth ===
export const adminLogin = (username: string, password: string) => {
  const params = new URLSearchParams();
  params.append('username', username);
  params.append('password', password);
  return apiClient.post('/admin/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const adminVerify = () =>
  apiClient.get('/admin/verify');

// === Self-registration (open/closed controlled by superadmin) ===
export const getAdminRegistrationStatus = () =>
  apiClient.get('/admin/registration');

export const publicRegisterAdmin = (username: string, displayName: string, password: string) => {
  const params = new URLSearchParams();
  params.append('username', username);
  params.append('display_name', displayName);
  params.append('password', password);
  return apiClient.post('/admin/register', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const setAdminRegistrationStatus = (open: boolean) => {
  const params = new URLSearchParams();
  params.append('open', String(open));
  return apiClient.put('/admin/registration', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

// === Admin Users (superadmin only) ===
export const listAdminUsers = () =>
  apiClient.get('/admin/users');

export const createAdminUser = (username: string, displayName: string, password: string) => {
  const params = new URLSearchParams();
  params.append('username', username);
  params.append('display_name', displayName);
  params.append('password', password);
  return apiClient.post('/admin/users', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const updateAdminUser = (userId: number, data: { display_name?: string; password?: string; is_active?: boolean }) => {
  const params = new URLSearchParams();
  if (data.display_name !== undefined) params.append('display_name', data.display_name);
  if (data.password !== undefined) params.append('password', data.password);
  if (data.is_active !== undefined) params.append('is_active', String(data.is_active));
  return apiClient.put(`/admin/users/${userId}`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const deleteAdminUser = (userId: number) =>
  apiClient.delete(`/admin/users/${userId}`);

// === Exams (Admin) ===
export const listExams = () =>
  apiClient.get('/admin/exams');

export const getExam = (id: number) =>
  apiClient.get(`/admin/exams/${id}`);

export const createExam = (title: string, description?: string) => {
  const params = new URLSearchParams();
  params.append('title', title);
  if (description) params.append('description', description);
  return apiClient.post('/admin/exams', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const updateExam = (id: number, title?: string, description?: string) => {
  const params = new URLSearchParams();
  if (title) params.append('title', title);
  if (description) params.append('description', description);
  return apiClient.put(`/admin/exams/${id}`, params);
};

export const deleteExam = (id: number) =>
  apiClient.delete(`/admin/exams/${id}`);

export const togglePublish = (id: number) =>
  apiClient.put(`/admin/exams/${id}/publish`);

export const manageShareToken = (examId: number, action: 'generate' | 'revoke') => {
  const params = new URLSearchParams();
  params.append('action', action);
  return apiClient.put(`/admin/exams/${examId}/share-token`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

// === Cases (Admin) ===
export const addCase = (examId: number, formData: FormData) =>
  apiClient.post(`/admin/exams/${examId}/cases`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  });

export const addCaseMultiFiles = (examId: number, formData: FormData) =>
  apiClient.post(`/admin/exams/${examId}/cases/multi`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  });

export const appendDicomToCase = (caseId: number, formData: FormData) =>
  apiClient.post(`/admin/cases/${caseId}/append-dicom`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: UPLOAD_TIMEOUT_MS,
  });

export const createCaseDraft = (examId: number) => {
  const params = new URLSearchParams();
  params.append('notes', '');
  return apiClient.post(`/admin/exams/${examId}/cases/draft`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const updateCase = (caseId: number, notes?: string, sortOrder?: number) => {
  const params = new URLSearchParams();
  if (notes !== undefined) params.append('notes', notes);
  if (sortOrder !== undefined) params.append('sort_order', String(sortOrder));
  return apiClient.put(`/admin/cases/${caseId}`, params);
};

export const deleteCase = (caseId: number) =>
  apiClient.delete(`/admin/cases/${caseId}`);

export const deleteSeries = (seriesId: number) =>
  apiClient.delete(`/admin/series/${seriesId}`);

// === Questions (Admin) ===
export const addQuestion = (
  caseId: number,
  questionType: string,
  questionText: string,
  correctAnswer: string,
  options?: string,
  sortOrder: number = 0,
) => {
  const params = new URLSearchParams();
  params.append('question_type', questionType);
  params.append('question_text', questionText);
  params.append('correct_answer', correctAnswer);
  if (options) params.append('options', options);
  params.append('sort_order', String(sortOrder));
  return apiClient.post(`/admin/cases/${caseId}/questions`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const updateQuestion = (
  questionId: number,
  data: Record<string, string | number>,
) => {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => {
    if (v !== undefined && v !== null) params.append(k, String(v));
  });
  return apiClient.put(`/admin/questions/${questionId}`, params);
};

export const deleteQuestion = (questionId: number) =>
  apiClient.delete(`/admin/questions/${questionId}`);

// === User Exam ===
export const getExamInfo = (accessCode: string) =>
  apiClient.get(`/exam/${accessCode}`);

export const registerUser = (accessCode: string, name: string, department?: string, employeeId?: string) => {
  const params = new URLSearchParams();
  params.append('name', name);
  if (department) params.append('department', department);
  if (employeeId) params.append('employee_id', employeeId);
  return apiClient.post(`/exam/${accessCode}/register`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const getExamCases = (accessCode: string) =>
  apiClient.get(`/exam/${accessCode}/cases`);

export const getCaseDetail = (accessCode: string, caseId: number, sessionId: number) =>
  apiClient.get(`/exam/${accessCode}/cases/${caseId}`, { params: { session_id: sessionId } });

export const submitCaseAnswer = (accessCode: string, caseId: number, sessionId: number, answers: Record<string, string>) => {
  const params = new URLSearchParams();
  params.append('session_id', String(sessionId));
  if (Object.keys(answers).length > 0) {
    params.append('answers', JSON.stringify(answers));
  }
  return apiClient.post(`/exam/${accessCode}/cases/${caseId}/answer`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const submitExam = (accessCode: string, sessionId: number) => {
  const params = new URLSearchParams();
  params.append('session_id', String(sessionId));
  return apiClient.post(`/exam/${accessCode}/submit`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
};

export const getResult = (sessionId: number, accessCode: string) =>
  apiClient.get(`/exam/session/${sessionId}/result`, { params: { access_code: accessCode } });
