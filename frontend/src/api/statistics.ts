import apiClient from './client';

export const getOverview = (examId: number, shareToken?: string) =>
  apiClient.get(`/admin/statistics/${examId}/overview`, shareToken ? { params: { share_token: shareToken } } : undefined);

export const getPerQuestion = (examId: number, shareToken?: string) =>
  apiClient.get(`/admin/statistics/${examId}/per-question`, shareToken ? { params: { share_token: shareToken } } : undefined);

export const getPerUser = (examId: number, shareToken?: string) =>
  apiClient.get(`/admin/statistics/${examId}/per-user`, shareToken ? { params: { share_token: shareToken } } : undefined);

export const getTimeDistribution = (examId: number, shareToken?: string) =>
  apiClient.get(`/admin/statistics/${examId}/time-distribution`, shareToken ? { params: { share_token: shareToken } } : undefined);

export const getCaseAnalysis = (examId: number, shareToken?: string) =>
  apiClient.get(`/admin/statistics/${examId}/case-analysis`, shareToken ? { params: { share_token: shareToken } } : undefined);
