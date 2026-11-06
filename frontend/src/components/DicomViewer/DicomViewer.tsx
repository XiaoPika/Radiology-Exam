import { useEffect, useRef, useCallback, useState } from 'react';
import {
  RenderingEngine,
  Enums,
  type Types,
} from '@cornerstonejs/core';
import {
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  PanTool,
  StackScrollTool,
  Enums as ToolsEnums,
  utilities as CsToolsUtilities,
} from '@cornerstonejs/tools';
import { initCornerstone } from './cornerstoneInit';
import { getDicomFrameImageId } from '../../api/dicom';

interface DicomViewerProps {
  caseFolder: string;
  seriesIndex: number;
  imageCount: number;
}

const VIEWPORT_ID = 'dicom-stack-viewport';
const RENDERING_ENGINE_ID = 'radiology-rendering-engine';

// ─────────────────────────────────────────────────────────────────────────────
// Custom vertical slice slider
//
// Replaces <input type="range" style="transform:rotate"> which loses its touch
// hit-test mapping after rotation (browser still treats it as horizontal).
// This implementation uses pointer events directly, so it works correctly on
// both desktop and mobile regardless of visual orientation.
// ─────────────────────────────────────────────────────────────────────────────
interface VerticalSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}

function VerticalSlider({ min, max, value, onChange }: VerticalSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Map a clientY position inside the track to a slice index.
  // Top of track = max value (first slice visually at top → high index feels
  // natural when the slider thumb is near the top), but radiologists expect
  // "drag down = next slice", so we invert: top = max, bottom = min.
  const valueFromClientY = (clientY: number) => {
    const track = trackRef.current;
    if (!track) return value;
    const { top, height } = track.getBoundingClientRect();
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - top) / height));
    return Math.round(ratio * (max - min)) + min;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Capture so pointermove keeps coming even if finger moves outside the element.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Stop propagation so the Cornerstone viewport's pointerdown handler
    // doesn't also capture this pointer (they're siblings, but be explicit).
    e.stopPropagation();
    dragging.current = true;
    onChange(valueFromClientY(e.clientY));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onChange(valueFromClientY(e.clientY));
  };

  const onPointerUp = () => { dragging.current = false; };

  // thumb position: 0 % = top of track (value = max), 100 % = bottom (value = min)
  const thumbPct = max > min ? (1 - (value - min) / (max - min)) * 100 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        right: 4,
        top: 50,
        bottom: 50,
        width: 28,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 10,
        touchAction: 'none',   // must be set so browser doesn't scroll the page
        cursor: 'ns-resize',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* track */}
      <div
        ref={trackRef}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 18,           // leave room for label below
          left: '50%',
          transform: 'translateX(-50%)',
          width: 4,
          background: 'rgba(255,255,255,0.25)',
          borderRadius: 2,
        }}
      >
        {/* thumb */}
        <div
          style={{
            position: 'absolute',
            top: `${thumbPct}%`,
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 18,
            height: 18,
            background: '#1677ff',
            border: '2px solid rgba(255,255,255,0.8)',
            borderRadius: '50%',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
            pointerEvents: 'none',  // clicks pass through to track div
          }}
        />
      </div>
      {/* current slice label */}
      <span
        style={{
          position: 'absolute',
          bottom: 0,
          color: 'rgba(255,255,255,0.7)',
          fontSize: 10,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DicomViewer
// ─────────────────────────────────────────────────────────────────────────────
export default function DicomViewer({ caseFolder, seriesIndex, imageCount }: DicomViewerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const toolGroupRef = useRef<any>(null);
  const [currentSlice, setCurrentSlice] = useState(1);
  const [activeTool, setActiveTool] = useState<string>('Scroll');
  const [imagesLoaded, setImagesLoaded] = useState(false);
  // Whether the *first frame*'s pixel data is loaded and ready to display.
  // Cleared as soon as `viewport.setStack()` resolves (see the comment at
  // that call site) — a promise that only settles once the network fetch
  // and decode are done — and, redundantly, by the IMAGE_RENDERED/
  // IMAGE_LOADED DOM events if those happen to fire first.
  const [imageLoading, setImageLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Bumping this re-runs the init effect from scratch — used by the "重试"
  // button on the failure overlay so a transient load failure doesn't force
  // a full page reload (which, pre-persist-fix, also meant re-registering).
  const [retryTick, setRetryTick] = useState(0);

  // Keep a ref in sync so switchTool (useCallback) can read it without
  // needing to be recreated every time isMobile changes.
  const isMobileRef = useRef(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768 || 'ontouchstart' in window;
      setIsMobile(mobile);
      isMobileRef.current = mobile;
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ── Cornerstone initialisation ──────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const cleanupFns: Array<() => void> = [];

    // Reset loading state for this series/case; re-established once the
    // first frame is loaded (see setStack() below) or fails.
    setImageLoading(true);
    setLoadFailed(false);

    async function setup() {
      await initCornerstone();
      if (!mounted || !elementRef.current) return;
      const element = elementRef.current;

      const imageIds: string[] = [];
      for (let i = 0; i < imageCount; i++) {
        imageIds.push(getDicomFrameImageId(caseFolder, seriesIndex, i));
      }

      if (renderingEngineRef.current) {
        try { renderingEngineRef.current.destroy(); } catch (_) {}
        renderingEngineRef.current = null;
      }

      try {
        // ── Viewport ───────────────────────────────────────────────────────
        const renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);
        renderingEngineRef.current = renderingEngine;

        renderingEngine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.STACK,
          element,
          defaultOptions: { background: [0, 0, 0] as Types.Point3 },
        });

        const viewport = renderingEngine.getViewport(VIEWPORT_ID) as Types.IStackViewport;
        await viewport.setStack(imageIds, 0);
        // setStack resolves once the first frame is fetched + decoded (and
        // already in Cornerstone's cache from the prefetcher). All that
        // remains is a GPU paint. We force a canvas resize here because
        // the ResizeObserver fires via rAF — if render() runs before the
        // observer fires, Cornerstone paints to a stale canvas size and
        // the output is blank. Calling resize() first synchronises the
        // canvas dimensions to the current element size so the subsequent
        // render() always paints to the right area.
        if (mounted) {
          try { renderingEngine.resize(true, true); } catch (_) {}
          setImageLoading(false);
        }
        viewport.render();

        // ── Fix: touch-action on Cornerstone-generated canvas ──────────────
        // React's touchAction:'none' only covers the wrapper div.
        // Cornerstone inserts a <canvas> (and sometimes a wrapper <div>)
        // that inherit the default touch-action:auto, letting the browser
        // intercept gestures before Cornerstone's pointer handlers see them.
        const applyTouchNone = () => {
          element.querySelectorAll<HTMLElement>('canvas, div').forEach((el) => {
            el.style.touchAction = 'none';
          });
        };
        applyTouchNone();
        const rafId = requestAnimationFrame(applyTouchNone);
        cleanupFns.push(() => cancelAnimationFrame(rafId));

        // ── Fix: pointer capture so drag events survive browser scroll detection
        // iOS / Android detect "scroll intent" after pointerdown and will stop
        // sending pointermove to the element. Capturing the pointer overrides
        // that and guarantees all subsequent events arrive at `element`.
        const onPointerDown = (e: PointerEvent) => {
          try { element.setPointerCapture(e.pointerId); } catch (_) {}
        };
        element.addEventListener('pointerdown', onPointerDown);
        cleanupFns.push(() => element.removeEventListener('pointerdown', onPointerDown));

        // Prevent native browser pan/zoom inside the viewer element (passive:false
        // required to be allowed to call preventDefault).
        const blockNativeTouch = (e: TouchEvent) => { e.preventDefault(); };
        element.addEventListener('touchstart', blockNativeTouch, { passive: false });
        element.addEventListener('touchmove',  blockNativeTouch, { passive: false });
        cleanupFns.push(() => {
          element.removeEventListener('touchstart', blockNativeTouch);
          element.removeEventListener('touchmove',  blockNativeTouch);
        });

        // ── Fix: ResizeObserver keeps canvas matching element dimensions ────
        // Without this, the canvas keeps its pixel size from enableElement()
        // time; when the CSS box grows/shrinks (mobile address bar, rotation)
        // the image appears stretched.
        const onResize = () => {
          requestAnimationFrame(() => {
            try { renderingEngineRef.current?.resize(true, true); } catch (_) {}
          });
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(element);
        cleanupFns.push(() => ro.disconnect());
        const initRaf = requestAnimationFrame(onResize);
        cleanupFns.push(() => cancelAnimationFrame(initRaf));

        // ── Tool group ─────────────────────────────────────────────────────
        try {
          if (ToolGroupManager.getToolGroup(VIEWPORT_ID)) {
            ToolGroupManager.destroyToolGroup(VIEWPORT_ID);
          }
        } catch (_) {}

        const toolGroup = ToolGroupManager.createToolGroup(VIEWPORT_ID);
        toolGroupRef.current = toolGroup;
        if (!toolGroup) return;

        toolGroup.addTool(WindowLevelTool.toolName);
        toolGroup.addTool(ZoomTool.toolName);
        toolGroup.addTool(PanTool.toolName);
        // StackScrollTool — `invert` flips wheel/drag direction.
        // The default (invert:false) maps wheel-up → forward (slice index
        // increases), which radiologists find backwards: they expect wheel-up
        // = scroll toward the *top* of the stack = smaller index. We invert
        // on PC so wheel-up decreases the index. On mobile the single-finger
        // drag direction has shipped that way and no one complained, so we
        // keep it unchanged (invert:false) there. Note: addTool config is set
        // once here; setToolActive does not reset it.
        toolGroup.addTool(StackScrollTool.toolName, {
          configuration: { invert: !isMobileRef.current, loop: false },
        });
        toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);

        // Default bindings — mobile-aware.
        //
        // PC:     Wheel → scroll slices  |  Primary (left drag) → W/L
        // Mobile: Primary (1 finger) → scroll slices
        //         Two fingers → pinch-to-zoom (always active, regardless of selected tool)
        //
        // numTouchPoints:2 binding on ZoomTool is permanent on mobile so that
        // double-finger pinch always zooms, even when another tool is selected
        // for single-finger interaction.  Cornerstone picks the tool by matching
        // numTouchPoints first, then falls back to mouseButton for 1-finger.
        if (isMobileRef.current) {
          toolGroup.setToolActive(StackScrollTool.toolName, {
            bindings: [
              { mouseButton: ToolsEnums.MouseBindings.Wheel },
              { mouseButton: ToolsEnums.MouseBindings.Primary },
            ],
          });
          // ZoomTool always active for 2-finger pinch on mobile.
          // The { numTouchPoints: 2 } binding is distinct from any 1-finger
          // binding, so it doesn't conflict with whichever tool is on Primary.
          toolGroup.setToolActive(ZoomTool.toolName, {
            bindings: [{ numTouchPoints: 2 }],
          });
          toolGroup.setToolPassive(WindowLevelTool.toolName);
          toolGroup.setToolPassive(PanTool.toolName);
        } else {
          // PC defaults
          toolGroup.setToolActive(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
          });
          toolGroup.setToolActive(WindowLevelTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          toolGroup.setToolPassive(ZoomTool.toolName);
          toolGroup.setToolPassive(PanTool.toolName);
        }

        // ── Slice tracking via Cornerstone event ───────────────────────────
        const syncSlice = (evt: Event) => {
          const idx: number | undefined = (evt as CustomEvent).detail?.imageIdIndex;
          if (idx !== undefined) setCurrentSlice(idx + 1);
        };
        element.addEventListener(Enums.Events.STACK_NEW_IMAGE, syncSlice);
        cleanupFns.push(() => element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, syncSlice));

        // ── Real loading indicator ───────────────────────────────────────────
        // IMAGE_RENDERED fires after the viewport actually paints pixels,
        // which for a large DR frame only happens once the network decode
        // + GPU upload finish (5–10s). Until then the canvas stays black.
        const onRendered = () => {
          if (mounted) setImageLoading(false);
        };
        element.addEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
        cleanupFns.push(() => element.removeEventListener(Enums.Events.IMAGE_RENDERED, onRendered));

        const onImageLoaded = (evt: Event) => {
          // IMAGE_LOADED also means the image data is available; belt-and-
          // suspenders alongside IMAGE_RENDERED.
          if (mounted) setImageLoading(false);
        };
        element.addEventListener(Enums.Events.IMAGE_LOADED, onImageLoaded);
        cleanupFns.push(() => element.removeEventListener(Enums.Events.IMAGE_LOADED, onImageLoaded));

        const onFailed = () => {
          if (mounted) { setLoadFailed(true); setImageLoading(false); }
        };
        element.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onFailed);
        cleanupFns.push(() => element.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onFailed));

        // ── Frame prefetch (smooth browsing) ────────────────────────────────
        // stackPrefetch uses Cornerstone's imageLoadPoolManager to fetch frames
        // adjacent to the currently-displayed one into the in-memory cache,
        // queued at low priority. Combined with StackScrollTool's built-in
        // `debounceIfNotLoaded`, dragging the slider / wheel scrolling skips
        // uncached frames instead of blocking on each one, then backfills.
        // This is the single most impactful fix for "fast drag = stutter".
        // Capped at a small window to bound memory/bandwidth on 200-frame CTs.
        const stackPrefetch = (CsToolsUtilities as any)?.stackPrefetch;
        if (stackPrefetch) {
          try {
            stackPrefetch.setConfiguration({ maxImagesToPrefetch: 6, preserveExistingPool: true });
            stackPrefetch.enable(element);
            cleanupFns.push(() => {
              try { stackPrefetch.disable(element); } catch (_) {}
            });
          } catch (_) {}
        }

        setImagesLoaded(true);

      } catch (e) {
        console.error('DICOM Viewer init error:', e);
        // This previously left `imageLoading` stuck at `true` forever on any
        // setup failure (e.g. the first frame's network request failing —
        // a flaky mobile connection, a transient backend hiccup) since
        // nothing here ever cleared it or set loadFailed. That's exactly
        // the "第一个序列一直显示加载中" symptom: no error surfaced, no way
        // to recover short of a full page reload. Surface the failure
        // instead so the user gets the (now retryable) error overlay.
        if (mounted) {
          setLoadFailed(true);
          setImageLoading(false);
        }
      }
    }

    setup();

    return () => {
      mounted = false;
      cleanupFns.forEach((fn) => fn());
      if (sliceChangeRaf.current !== undefined) {
        cancelAnimationFrame(sliceChangeRaf.current);
        sliceChangeRaf.current = undefined;
      }
      try {
        if (toolGroupRef.current) {
          ToolGroupManager.destroyToolGroup(VIEWPORT_ID);
          toolGroupRef.current = null;
        }
        if (renderingEngineRef.current) {
          renderingEngineRef.current.destroy();
          renderingEngineRef.current = null;
        }
      } catch (_) {}
    };
  }, [caseFolder, seriesIndex, imageCount, retryTick]);

  // ── Tool switching ──────────────────────────────────────────────────────
  //
  // Key invariant: on mobile, whichever tool is "active" must be bound to
  // Primary (= single finger drag).  On PC, Primary is always left mouse
  // button; Wheel always scrolls slices.
  //
  // We intentionally do NOT include isMobile in the dependency array;
  // instead we read isMobileRef.current so the callback is stable and can
  // be called any time without stale-closure issues.
  const switchTool = useCallback((toolName: string) => {
    const toolGroup = toolGroupRef.current;
    if (!toolGroup) return;

    const mobile = isMobileRef.current;

    // Disable everything first, then re-enable what we need.
    toolGroup.setToolPassive(WindowLevelTool.toolName);
    toolGroup.setToolPassive(ZoomTool.toolName);
    toolGroup.setToolPassive(PanTool.toolName);
    toolGroup.setToolPassive(StackScrollTool.toolName);

    if (mobile) {
      // ── Mobile bindings ────────────────────────────────────────────────
      // Single finger drag → whatever tool is active.
      // Two fingers always → ZoomTool pinch (numTouchPoints:2 binding, permanent).
      // Wheel bound as fallback for hybrid devices.

      // ZoomTool always keeps its 2-finger binding regardless of which tool
      // is selected for single-finger interaction.
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ numTouchPoints: 2 }],
      });

      switch (toolName) {
        case 'Scroll':
          toolGroup.setToolActive(StackScrollTool.toolName, {
            bindings: [
              { mouseButton: ToolsEnums.MouseBindings.Wheel },
              { mouseButton: ToolsEnums.MouseBindings.Primary },
            ],
          });
          break;
        case 'W/L':
          // Keep scroll on wheel so devices with mice still work.
          toolGroup.setToolActive(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
          });
          toolGroup.setToolActive(WindowLevelTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          break;
        case 'Zoom':
          // Single finger also zooms; two fingers still zoom via numTouchPoints:2.
          toolGroup.setToolActive(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
          });
          toolGroup.setToolActive(ZoomTool.toolName, {
            bindings: [
              { mouseButton: ToolsEnums.MouseBindings.Primary },
              { numTouchPoints: 2 },
            ],
          });
          break;
        case 'Pan':
          toolGroup.setToolActive(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
          });
          toolGroup.setToolActive(PanTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          break;
      }
    } else {
      // ── PC bindings ────────────────────────────────────────────────────
      // Wheel always scrolls slices.  Left button = the selected tool
      // (or W/L when 'Scroll' is chosen, matching radiologist convention).
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: ToolsEnums.MouseBindings.Wheel }],
      });
      switch (toolName) {
        case 'W/L':
          toolGroup.setToolActive(WindowLevelTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          break;
        case 'Zoom':
          toolGroup.setToolActive(ZoomTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          break;
        case 'Pan':
          toolGroup.setToolActive(PanTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          break;
        case 'Scroll':
        default:
          // On PC "浏览" keeps W/L on left button — scroll wheel already scrolls.
          toolGroup.setToolActive(WindowLevelTool.toolName, {
            bindings: [{ mouseButton: ToolsEnums.MouseBindings.Primary }],
          });
          break;
      }
    }

    setActiveTool(toolName);
  }, []); // isMobileRef is a ref, never changes identity → no dep needed

  // ── Reset ───────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    try {
      const vp = renderingEngineRef.current?.getViewport(VIEWPORT_ID) as Types.IStackViewport;
      if (vp) { vp.resetCamera(); vp.render(); }
    } catch (e) { console.error('Reset error:', e); }
  }, []);

  // Re-runs the whole init effect (bumping retryTick is a dependency-array
  // change) so a transient load failure can be recovered from inline instead
  // of forcing a full page reload.
  const handleRetry = useCallback(() => {
    setRetryTick((t) => t + 1);
  }, []);

  // ── Slice change from custom slider ────────────────────────────────────
  // Throttle the actual viewport setImageIdIndex to one per animation frame:
  // the slider can fire a pointermove per pixel of drag, and queueing dozens
  // of setImageIdIndex calls mid-drag triggers a decode request per frame
  // (visible as stutter / black flashes on uncached frames). The label
  // (currentSlice) updates immediately so the slider thumb feels responsive;
  // the heavyweight index switch is coalesced.
  const sliceChangeRaf = useRef<number | undefined>(undefined);
  const handleSliceChange = useCallback((slice: number) => {
    setCurrentSlice(slice);
    if (sliceChangeRaf.current !== undefined) {
      cancelAnimationFrame(sliceChangeRaf.current);
    }
    sliceChangeRaf.current = requestAnimationFrame(() => {
      sliceChangeRaf.current = undefined;
      try {
        const vp = renderingEngineRef.current?.getViewport(VIEWPORT_ID) as any;
        if (vp) vp.setImageIdIndex(slice - 1);
      } catch (_) {}
    });
  }, []);

  const tools = [
    { key: 'W/L',    label: '调窗' },
    { key: 'Zoom',   label: '缩放' },
    { key: 'Pan',    label: '移动' },
    { key: 'Scroll', label: '浏览' },
  ];

  return (
    <div style={{
      position: 'relative',
      background: '#000',
      borderRadius: '8px',
      overflow: 'hidden',
      touchAction: 'none',  // outer wrapper opt-out from native scroll
    }}>
      {/* Info overlay */}
      <div className="dicom-overlay" style={{ top: 8, left: 8 }}>
        {isMobile ? '触屏' : 'PC'} · {activeTool} | {currentSlice}/{imageCount}
      </div>

      {/* Toolbar */}
      <div style={{
        position: 'absolute', top: 8, right: isMobile ? 36 : 8,
        display: 'flex', gap: 4, zIndex: 10,
        flexWrap: 'wrap', justifyContent: 'flex-end',
      }}>
        {tools.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTool(t.key)}
            style={{
              padding: '4px 12px', fontSize: '12px',
              border: '1px solid rgba(255,255,255,0.4)',
              background: activeTool === t.key
                ? 'rgba(22,119,255,0.85)'
                : 'rgba(0,0,0,0.6)',
              color: '#fff', borderRadius: '4px',
              cursor: 'pointer', whiteSpace: 'nowrap',
              backdropFilter: 'blur(4px)',
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={handleReset}
          style={{
            padding: '4px 12px', fontSize: '12px',
            border: '1px solid rgba(255,255,255,0.4)',
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            borderRadius: '4px', cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          重置
        </button>
      </div>

      {/* Cornerstone viewport */}
      <div
        ref={elementRef}
        style={{
          width: '100%',
          height: isMobile ? '400px' : '550px',
          cursor: activeTool === 'W/L'  ? 'crosshair'
               : activeTool === 'Zoom' ? 'zoom-in'
               : activeTool === 'Pan'  ? 'grab'
               : 'default',
          touchAction: 'none',
        }}
      />

      {/* Slice slider — available on both PC and mobile.
          VerticalSlider uses pointer events directly, so a desktop mouse
          left-drag works the same as a mobile finger without any extra code. */}
      {imagesLoaded && imageCount > 1 && (
        <VerticalSlider
          min={1}
          max={imageCount}
          value={currentSlice}
          onChange={handleSliceChange}
        />
      )}

      {/* Loading indicator — real first-frame rendering signal */}
      {imageLoading && !loadFailed && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '12px',
          background: 'rgba(0,0,0,0.55)',
          zIndex: 5, pointerEvents: 'none',
        }}>
          <div style={{
            width: '36px', height: '36px',
            border: '4px solid rgba(255,255,255,0.25)',
            borderTop: '4px solid #1677ff',
            borderRadius: '50%',
            animation: 'dicom-spin 0.8s linear infinite',
          }} />
          <span style={{ color: '#fff', fontSize: '14px' }}>加载中...</span>
        </div>
      )}

      {/* Load failure indicator */}
      {loadFailed && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '8px',
          background: 'rgba(0,0,0,0.6)',
          zIndex: 5,
        }}>
          <span style={{ color: '#fff', fontSize: '15px' }}>⚠ 图像加载失败</span>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>网络波动或加载超时，可点击重试</span>
          <button
            onClick={handleRetry}
            style={{
              marginTop: '4px', padding: '6px 20px', fontSize: '13px',
              background: '#1677ff', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      )}

      {/* keyframes for the spinner (sheet-scoped via this <style> tag) */}
      <style>{`@keyframes dicom-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
