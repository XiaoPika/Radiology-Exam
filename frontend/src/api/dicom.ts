import apiClient from './client';

const viteEnv = (import.meta as any).env || {};
const trimTrailingSlash = (value: string) => (value || '').replace(/\/$/, '');

// By default, DICOM files and frames are served directly from the same origin (/api/dicom/...)
// An optional VITE_DICOM_BASE_URL can be configured if using a dedicated CDN or static storage server.
const DICOM_BASE_URL = trimTrailingSlash(viteEnv.VITE_DICOM_BASE_URL || '');

const dicomUrl = (path: string) => `${DICOM_BASE_URL}${path}`;

export const getDicomMetadata = (caseFolder: string, seriesIndex: number = 0) =>
  apiClient.get(`/dicom/${caseFolder}/series/${seriesIndex}/metadata`);

export const getDicomImageList = (caseFolder: string, seriesIndex: number = 0) =>
  apiClient.get(`/dicom/${caseFolder}/series/${seriesIndex}/images`);

export const getDicomFrameUrl = (caseFolder: string, seriesIndex: number, frameIndex: number) =>
  dicomUrl(`/api/dicom/${caseFolder}/series/${seriesIndex}/frame/${frameIndex}`);

export const getDicomFrameImageId = (caseFolder: string, seriesIndex: number, frameIndex: number) =>
  `wadouri:${getDicomFrameUrl(caseFolder, seriesIndex, frameIndex)}`;

export const getThumbnailUrl = (caseFolder: string, seriesIndex: number = 0) =>
  dicomUrl(`/api/dicom/${caseFolder}/series/${seriesIndex}/thumbnail`);

// Helper: normalize a stored thumbnail_url to the canonical /series/{index}/thumbnail format
export const normalizeThumbnailUrl = (storedUrl: string): string => {
  return dicomUrl(storedUrl.replace(/\/series_(\d+)\/thumbnail$/, '/series/$1/thumbnail'));
};
