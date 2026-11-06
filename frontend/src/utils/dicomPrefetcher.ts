/**
 * Module-level sequential DICOM prefetcher.
 *
 * WHY sequential (concurrency = 1):
 * Total bandwidth is ~100 KB/s. Downloading one frame at a time gives that
 * frame the full bandwidth so case-1 finishes in ~3 min, not spread across
 * all cases simultaneously and never completing.
 *
 * WHY Cornerstone imageLoader instead of fetch():
 * fetch() only populates the browser HTTP disk cache. Cornerstone still has to
 * parse + decode each DICOM file from scratch (seconds per large DR image)
 * before it can render, so the user still sees lag.
 * imageLoader.loadAndCacheImage() goes one step further: it fetches AND decodes
 * the image, storing the decoded pixel data in Cornerstone's in-memory image
 * cache. When setStack() is called later, the image is found in memory and
 * renders instantly with no decode overhead.
 *
 * WHY module-level (not React state / component-scoped):
 * The prefetch must survive navigation. RegisterPage starts it; when the user
 * clicks "开始答题" and RegisterPage unmounts, the download must keep running.
 */

import { imageLoader } from '@cornerstonejs/core';
import { initCornerstone } from '../components/DicomViewer/cornerstoneInit';
import { getDicomFrameImageId } from '../api/dicom';

export interface PrefetchCaseInfo {
  dicom_folder: string;
  series: Array<{
    series_folder: string;
    image_count: number;
  }>;
}

let _abort: AbortController | null = null;

function buildQueue(cases: PrefetchCaseInfo[], startCaseIndex: number): string[] {
  const imageIds: string[] = [];
  for (let ci = startCaseIndex; ci < cases.length; ci++) {
    const c = cases[ci];
    for (const s of c.series) {
      const m = s.series_folder.match(/series_(\d+)$/);
      const si = m ? parseInt(m[1], 10) : 0;
      for (let fi = 0; fi < s.image_count; fi++) {
        imageIds.push(getDicomFrameImageId(c.dicom_folder, si, fi));
      }
    }
  }
  return imageIds;
}

async function runLoop(imageIds: string[], signal: AbortSignal): Promise<void> {
  // Ensure Cornerstone + dicom-image-loader are initialized so the wadouri:
  // scheme is registered before we call loadAndCacheImage.
  await initCornerstone();
  for (const imageId of imageIds) {
    if (signal.aborted) return;
    try {
      // loadAndCacheImage fetches the DICOM file (from HTTP disk cache if already
      // downloaded, otherwise from the network) AND decodes it into Cornerstone's
      // in-memory image cache. A subsequent setStack() call that references this
      // imageId will find the decoded image in cache and render without any decode
      // overhead.
      await imageLoader.loadAndCacheImage(imageId);
    } catch {
      // Transient network error or decode failure — skip and continue.
    }
  }
}

export function startPrefetch(cases: PrefetchCaseInfo[]): void {
  stop();
  if (!cases.length) return;
  _abort = new AbortController();
  runLoop(buildQueue(cases, 0), _abort.signal);
}

export function prioritizeFrom(caseIndex: number, cases: PrefetchCaseInfo[]): void {
  stop();
  if (!cases.length) return;
  _abort = new AbortController();
  runLoop(buildQueue(cases, caseIndex), _abort.signal);
}

export function stop(): void {
  _abort?.abort();
  _abort = null;
}
