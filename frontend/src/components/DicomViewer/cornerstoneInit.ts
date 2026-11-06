import { init as csInit } from '@cornerstonejs/core';
import {
  init as csToolsInit,
  addTool,
  WindowLevelTool,
  ZoomTool,
  PanTool,
  StackScrollTool,
} from '@cornerstonejs/tools';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

let initPromise: Promise<void> | null = null;

export async function initCornerstone() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await csInit();
    await csToolsInit();

    // Register tools globally BEFORE creating ToolGroups.
    // Without this, toolGroup.addTool(SomeTool.toolName) will fail with
    // "'SomeTool' is not registered with the library."
    addTool(WindowLevelTool);
    addTool(ZoomTool);
    addTool(PanTool);
    addTool(StackScrollTool);

    // Must be called AFTER csInit() because it imports registerImageLoader from core.
    dicomImageLoader.init();
  })();

  return initPromise;
}
